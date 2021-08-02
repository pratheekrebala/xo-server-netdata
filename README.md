## Netdata plugin for Xen Orchestra

This is an attempt at automating the installation of netdata for XCP-NG servers that are running a community version of Xen Orchestra.

**This plugin is not supported or endorsed by Xen Orchestra or Vates**



## Goals

Provide a _one click_ option to install and configure NetData on Xen Orchestra hosts. The plugin should exclusively use XAPI methods where possible to interact with the hosts and provide all of it's functionality using the plugin api and not modify any of the underlying code from Xen Orchestra.

## Installation

If you are using the community build script from [ronivay/XenOrchestraInstallerUpdater](https://github.com/ronivay/XenOrchestraInstallerUpdater):

1. Add this repos URL to the `ADDITIONAL_PLUGINS` flag inside the `xo-install.cfg` file:

```
ADDITIONAL_PLUGINS="https://github.com/pratheekrebala/xo-server-netdata.git"
```

1. If you are installing this manually, clone this repo inside the `xen-orchestra/packages/` directory and build, install the plugin and restart the `xo-server` service:

```
yarn && yarn build && systemctl restart xo-server
```

## Things the plugin needs to do:

1. Install and enable NetData as a system service on the Xen Orchestra VM.
    - The distribution repos have a slightly older version of netdata so this plugin adds the

1. Once installed on the Xen Orchestra VM, acquire the host api key and ip address.

1. Call the XAPI plugin that installs netdata on the host machines (`install_netdata`) and pass the ip address and api key from the Xen Orchestra VM.

1. Deploy plugin methods that the Xen Orchestra front-end relies on to test if the installation is done. This will enable the interface to receive this data directly.

    1. netdata.isConfiguredToReceiveStreaming [ref](https://github.com/vatesfr/xen-orchestra/blob/f2a860b01a91795aeb7ff0453a82403fb2048764/packages/xo-web/src/common/xo/index.js#L633)
        - Guessing this should return true if everything is configured correctly.
        - This is checked by the UI to enable the telemetry.
    1. netdata.configureXoaToReceiveData [ref](https://github.com/vatesfr/xen-orchestra/blob/f2a860b01a91795aeb7ff0453a82403fb2048764/packages/xo-web/src/common/xo/index.js#L635)
        - This should be run before configuring the host.
        - Installs netdata, gets the local key and writes the appropriate configuration.
        - Stub this with error message that our plugin requires global settings.
    1. netdata.configureHostToStreamHere [ref](https://github.com/vatesfr/xen-orchestra/blob/f2a860b01a91795aeb7ff0453a82403fb2048764/packages/xo-web/src/common/xo/index.js#L637)
        - This should be run after `configureXoaToReceiveData`. (becuase we need local api key)
        - Calls the `install_netdata` XAPI method using ip of Orchestra, a local api key and the port.
        - Stub this with error message that our plugin requires global settings.
    1. netdata.isNetDataInstalledOnHost [ref](https://github.com/vatesfr/xen-orchestra/blob/f2a860b01a91795aeb7ff0453a82403fb2048764/packages/xo-web/src/common/xo/index.js#L644)
        - This simply checks if the service is installed and enabled.
    1. netdata.getHostApiKey [ref](https://github.com/vatesfr/xen-orchestra/blob/f2a860b01a91795aeb7ff0453a82403fb2048764/packages/xo-web/src/common/xo/index.js#L649)
        - This should return the api key used by the netdata on the host machine.
    1. netdata.getLocalApiKey[ref](https://github.com/vatesfr/xen-orchestra/blob/f2a860b01a91795aeb7ff0453a82403fb2048764/packages/xo-web/src/common/xo/index.js#L652)
        - This should return the local api key from the Orchestra VM.



## Observations:

I couldn't find a guide for how to write plugins for Xen Orchestra. Here are some notes that I gleaned from looking through existing plugin packages. The `xo-server-sdn-controller` is very helpful.

- The plugin is a class object which has to provide the following methods:
    - `constructor()`
        - The options argument will contain an `xo` object which will provide a handle to the `xo-lib` client.
    - `configure()`
        - This function provides two arguments: `conf` and `state`.
        - You can check the `state.loaded` property to see if this is an initial (`null`) installation or a reconfiguration.
        - The plugin can provide a `configure()` method which will get called on the initial plugin load and also anytime a configuration is relaoded from the interface.
    - `load()`
        - This function is called when plugin is `loaded` either through the UI or on server (re)-start.
    - `unload()`
        - This function is called when plugin is disabled through the web ui.

- The plugin needs to export a `configurationSchema` object if it expects configuration from the UI.

- The default export is an anonymous function that will accept an options argument and initialize the class.

- Shell Execution
    - Seems like the preference is to use `execa` (which allows for Promise support)
    - The commands will run as root (because `xo-server` is run as root)

- Configuration:
    - The configuration required for the plugin can be specified using the `configurationSchema` export.
    - You can use the `$type` argument to populate specific types of objects (e.g. hosts, networks etc)
    - ```
        hosts: {
            type: 'array',
            title: 'Hosts',
            description: 'Hosts to enable telemetry on.',
            items: {
                type: 'string',
                $type: 'Host'
            }
        }```

## WIP - MORE TKTK

- Initialization:

- Creating a new API method:
    - This accepts a few different props: (xo-server/src/api/api.mjs)
        - description // Description of the plugin
        - params // params that the method accepts, will be resolved against resolve()
        - permission // global permission
        - resolve // checks for permsision on each child object?
            - checks if a given user has the permission action to perform task on given param.
            - accepts arguments: [param, types, permission] (xo-server/src/api/api.mjs:116)
            - `param` is the name of the parameter to validate from above
            - `types` checks against given "types" of objects, in this case check if user has admin on host.
            - `permission` checks the permission that the user has on an object of a given `type` with value in `param`. (we need `administrate`)