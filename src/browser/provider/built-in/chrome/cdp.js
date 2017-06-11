import remoteChrome from 'chrome-remote-interface';
import browserTools from 'testcafe-browser-tools';
import { writeFile } from '../../../../utils/promisified-functions';


async function getActiveTab (cdpPort, browserId) {
    var tabs = await remoteChrome.listTabs({ port: cdpPort });
    var tab  = tabs.filter(t => t.type === 'page' && t.url.indexOf(browserId) > -1)[0];

    return tab;
}

async function setEmulationBounds ({ client, config, viewportSize }) {
    await client.Emulation.setDeviceMetricsOverride({
        width:             viewportSize.width,
        height:            viewportSize.height,
        deviceScaleFactor: config.scaleFactor,
        mobile:            config.mobile,
        fitWindow:         false
    });

    await client.Emulation.setVisibleSize({ width: viewportSize.width, height: viewportSize.height });
}

async function setEmulation (runtimeInfo) {
    var { client, config } = runtimeInfo;

    if (config.userAgent !== void 0)
        await client.Network.setUserAgentOverride({ userAgent: config.userAgent });

    if (config.touch !== void 0) {
        await client.Emulation.setTouchEmulationEnabled({
            enabled:       config.touch,
            configuration: config.mobile ? 'mobile' : 'desktop'
        });
    }

    await resizeWindow({ width: config.width, height: config.height }, runtimeInfo);
}

export async function createClient (runtimeInfo) {
    var { browserId, config, cdpPort } = runtimeInfo;

    var tab = await getActiveTab(cdpPort, browserId);

    if (!tab)
        return;

    try {
        var client = await remoteChrome({ target: tab, port: cdpPort });
    }
    catch (e) {
        return;
    }

    runtimeInfo.tab    = tab;
    runtimeInfo.client = client;

    await client.Page.enable();
    await client.Network.enable();

    if (config.emulation)
        await setEmulation(runtimeInfo);
}

export function isHeadlessTab ({ tab, config }) {
    return tab && config.headless;
}

export async function closeTab ({ tab, cdpPort }) {
    await remoteChrome.closeTab({ id: tab.id, port: cdpPort });
}

export async function takeScreenshot (path, { client, config }) {
    var screenshot = await client.Page.captureScreenshot({ fromSurface: config.headless });

    await writeFile(path, screenshot.data, { encoding: 'base64' });
}

export async function resizeWindow (newDimensions, runtimeInfo) {
    var { browserId, config, viewportSize } = runtimeInfo;

    var currentWidth  = viewportSize.width;
    var currentHeight = viewportSize.height;
    var newWidth      = newDimensions.width || currentWidth;
    var newHeight     = newDimensions.height || currentHeight;


    if (!config.headless)
        await browserTools.resize(browserId, currentWidth, currentHeight, newWidth, newHeight);

    viewportSize.width  = newWidth;
    viewportSize.height = newHeight;

    if (config.emulation)
        await setEmulationBounds(runtimeInfo);
}