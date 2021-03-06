const execa = require('execa');

import { createLogger } from '@xen-orchestra/log';
import { readFile, writeFile } from 'fs/promises';

const log = createLogger('xo:xo-server:netdata');

const NETDATA_REPO = 'https://packagecloud.io/netdata/netdata/debian/';
const NETDATA_KEY = 'https://packagecloud.io/netdata/netdata/gpgkey';

export const configurationSchema = {
    description: 'Enable advanced telemetry on hosts using the NetData integration.',
    type: 'object',
    properties: {
        endpoint: {
            'type': 'string',
            'description': `Host IP for the server where the data should be streamed.`
        },
        port: {
            'type': 'string',
            'description': `Port where data should be streamed. Default: 19999`
        },
        hosts: {
            type: 'array',
            title: 'Hosts',
            description: 'Hosts to enable telemetry on.',
            items: {
                type: 'string',
                $type: 'Host'
            }
        }
    },
    required: ['endpoint', 'port', 'hosts']
}

class NetData {
    // The "xo" object is always passed, it's the current xo server instance.
    // This is going to be used to call relevant xapi methods.
    // We also are going to add additional api methods to this instance.
    constructor({ xo }) {
        this._xo = xo;
    }

    async configure(conf, state) {
        this._conf = conf;

        if (state.loaded) {
	        log.info('Reloading configuration');
            // plugin is already loaded, so let's go ahead and reload the configuration.
            // and initialize the hosts
            await this.getNetDataStatus();
            await this.configureXoaToReceiveData();
            await this.initialize();
        }
    }

    async getNetDataStatus() {
        const status = await execa('systemctl', ['show', 
            '-p', 'LoadState',
            '-p', 'ActiveState',
            '-p', 'SubState',
            '-p', 'UnitFileState',
            '--value', 'netdata'
        ]);
    
        const [load, active, sub, enabled] = status.stdout.split('\n');
        let error;
    
        if (load == 'loaded' && active == 'active' && sub == 'running') {
            log.info('NetData is installed and active.')
        } else if (load == 'not-found') {
            error = new Error('Could not find NetData service. Is it installed?')
        } else if (enabled == 'disabled') {
            error = new Error('Service is installed, but it will not run at boot.')
        } else {
            error = new Error('Unknown error.')
        }
    
        if (error) {
            log.error(error.message, { status } )
            error.data = status;
            throw error;
        } else return true
    }

    // get guid of netdata instance that is installed on the xen orchestra vm
    // this is *supposed* to be located at /var/lib/netdata/registry/netdata.public.unique.id
    // according to: https://learn.netdata.cloud/docs/agent/streaming#netdata-unique-id
    // should this be user-configurable?
    async getLocalApiKey() {
        const machine_guid_location = '/var/lib/netdata/registry/netdata.public.unique.id';
        const machine_guid = await readFile(machine_guid_location, 'utf8');
        log.info(`NetData receiver is identified by: ${machine_guid}`)
        return machine_guid;    
    }

    async getHostApiKey({ host }) {
        const host_xapi = this._xo.getXapi(host);
        const api_key = await host_xapi.call(
            'host.call_plugin', host._xapiRef,
            'netdata.py', 'get_netdata_api_key',
            {}
        );
        return api_key;
    }

    async streamConfiguration() {
        const machine_guid = await this.getLocalApiKey();
        const configData = `
[${machine_guid}]
        enabled = yes
        allow from = *
        default memory mode = ram
`;
        return configData;
    }

    async installNetData() {
        // fetch gpg key and add to keyring
        const keyring_path = '/usr/share/keyrings/netdata.gpg';
        
        await execa(
            `wget -q -O- "${NETDATA_KEY}" | sudo apt-key --keyring ${keyring_path} add -`,
            { shell: true }
        );
        
        // get distribution
        const { stdout: distribution } = await execa('lsb_release', ['-cs']);

        // add to apt sources
        const repo = `deb [signed-by=${keyring_path}] ${NETDATA_REPO} ${distribution} main`;
        
        await writeFile('/etc/apt/sources.list.d/netdata.list', repo);
        
        await execa('apt', ['update']);

        await execa('apt', ['install', '-y', 'netdata'])
    }

    async configureXoaToReceiveData() {
        const configData = await this.streamConfiguration();

        await writeFile('/etc/netdata/stream.conf', configData)
        
        await execa('systemctl', ['enable', 'netdata'])
        await execa('systemctl', ['restart', 'netdata'])

        return await this.getNetDataStatus()
    }

    async isNetDataInstalledOnHost({ host }) {
        // get an xapi handle on the host
        const host_xapi = this._xo.getXapi(host);
        // call the `is_netdata_installed` plugin on xcp
        try {
            await host_xapi.call(
                'host.call_plugin', host._xapiRef,
                'netdata.py', 'is_netdata_installed', {}
            )
            return true;
        } catch (error) {
            log.error(error)
            return false;
        }
    }

    // find a routable ip address for the provided host
    // this is v hacky, probably should allow user to specify
    async getRoutableIP(host_address) {
        const route = await execa('ip', ['route', 'get', host_address]);
        const route_elements = route.stdout.split(' ');
        const source_ip = route_elements[route_elements.indexOf('src')+1];

        return source_ip
    }

    async configureHostToStreamHere({ host }) {
        const host_xapi = this._xo.getXapi(host);
        
        const routable_ip = await this.getRoutableIP(host.address);
        const destination = `tcp:${routable_ip}:${this._conf.port}`;
        const api_key = await this.getLocalApiKey();

        return host_xapi.call(
            'host.call_plugin', host._xapiRef, 
            "netdata.py", "install_netdata",
            { api_key, destination }
        )
    }

    async isConfiguredToReceiveStreaming() {
        // Ensure NetData is installed on the main server.
        await this.getNetDataStatus();

        // Check if the contents of stream.conf are what we expect them to be.
        const currentConfig = await fs.readFile('/etc/netdata/stream.conf', 'utf8');
        const expectedConfig = await this.streamConfiguration();

        return currentConfig == expectedConfig;
    }

    async initialize() {
        const hosts = this._conf.hosts.map(
            host_id => this._xo.getObject(host_id, 'host')
        );

        // Iterate through each of the hosts and deploy NetData
        await Promise.all(
            hosts.map(async (host) => {
                await this.configureHostToStreamHere({ host });
                const success = await this.isNetDataInstalledOnHost({ host });

                if (!success) {
                    const error = Error(`Installation on ${host.uuid} failed.`);
                    log.error(error.message);
                    throw error
                } else {
                    log.info(`NetData successfully installed on ${host.uuid}`);
                }
            })
        );
    }

    // All plugins have load and un-load methods.
    // This method is called on both re-configuration & on 
    async load() {
        log.info(this);
        // Get Host Objects

        // Check if NetData is available on the server, install it if it is not.
        await this.getNetDataStatus();

        // Configure NetData receiver on XOA vm
        await this.configureXoaToReceiveData();
        
        const host_param = { host: { type: "string" }};
        const can_administrate_host = { host: ['host', 'host', 'administrate'] };

        // Method Definitions
        const methods = {
            isConfiguredToReceiveStreaming: {
            description: 'Check if the XOA host has the expected stream configuration.',
            permission: 'admin'
        }, configureXoaToReceiveData: {
            description: 'Install and configure NetData on XOA VM.',
            permission: 'admin'
        }, getLocalApiKey: {
            description: 'Get the UUID of the XOA VM, used as the api key by all hosts.',
            permission: 'admin'
        }, configureHostToStreamHere: {
            description: 'Call the XAPI methods to setup NetData on a given host and stream data to XOA',
            permission: 'admin',
            params: host_param,
            resolve: can_administrate_host
        }, isNetDataInstalledOnHost: {
            description: 'Check if NetData service is installed on the given host machine.',
            permission: 'admin',
            params: host_param,
            resolve: can_administrate_host
        }, getHostApiKey: {
            description: 'Get the API Key that is a given host is streaming with.',
            permission: 'admin',
            params: host_param,
            resolve: can_administrate_host
        }, installNetData: {
            description: 'Install latest up-stream NetData package.',
            permission: 'admin'
        }};

        const apiMethods = Object.entries(methods).map(([method_name, attributes]) => {
            const method = (params) => this[method_name](params);
            for (const [key, value] of Object.entries(attributes)) {
                method[key] = value
            };
            return [method_name, method]
        });

        this._unsetApiMethods = this._xo.addApiMethods({
            netdata: Object.fromEntries(apiMethods)
        });
    }

    async unload() {
        this._unsetApiMethods();

        /* await execa('systemctl', ['disable', 'netdata']);
        // ensure this is done
        const [status, error] = await this.getNetDataStatus();
        if (status) {
            const err = new Error('Cannot disable NetData');
            log.error(err.message);
            throw err;
        } else {
            log.info('NetData disabled, plugin successfully unloaded.');
        } */
    }
}

export default opts => new NetData(opts)
