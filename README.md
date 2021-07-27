## Netdata plugin for Xen Orchestra

This is an attempt at automating the installation of netdata for XCP-NG servers that are running a community version of Xen Orchestra.

## Things the plugin needs to do:

1. Install and enable NetData as a system service on the Xen Orchestra VM.

1. Once installed on the Xen Orchestra VM, acquire the host api key and ip address.

1. Call the XAPI plugin that installs netdata on the host machines (`install_netdata`) and pass the ip address and api key from the Xen Orchestra VM.

1. Deploy plugin methods that the Xen Orchestra front-end relies on to test if the installation is done. This will enable the interface to receive this data directly.

    1. netdata.isConfiguredToReceiveStreaming
        - Guessing this should return true if everything is configured correctly.
        - This is checked by the UI to enable the telemetry.
    1. netdata.configureXoaToReceiveData
        - This should be run before configuring the host.
        - Installs netdata, gets the local key and writes the appropriate configuration.
        - Stub this with error message that our plugin requires global settings.
    1. netdata.configureHostToStreamHere
        - This should be run after `configureXoaToReceiveData`. (becuase we need local api key)
        - Calls the `install_netdata` XAPI method using ip of Orchestra, a local api key and the port.
        - Stub this with error message that our plugin requires global settings.
    1. netdata.isNetDataInstalledOnHost
        - This simply checks if the service is installed and enabled.
    1. netdata.getHostApiKey
        - This should return the api key used by the netdata on the host machine.
    1. netdata.getLocalApiKey
        - This should return the local api key from the Orchestra VM.



## Observations:

I couldn't find a guide for how to write plugins for Xen Orchestra. Here are some notes that I gleaned from looking through existing plugin packages.

- Shell Execution, seems like the preference is to use `execa` (which allows for Promise support)

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