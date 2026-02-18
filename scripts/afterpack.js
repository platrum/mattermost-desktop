// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const {spawnSync} = require('child_process');
const path = require('path');

const {flipFuses, FuseVersion, FuseV1Options} = require('@electron/fuses');

const SETUID_PERMISSIONS = '4755';

function fixSetuid(context) {
    return async (target) => {
        if (!['appimage', 'snap'].includes(target.name.toLowerCase())) {
            const result = await spawnSync('chmod', [SETUID_PERMISSIONS, path.join(context.appOutDir, 'chrome-sandbox')]);
            if (result.error) {
                throw new Error(
                    `Failed to set proper permissions for linux arch on ${target.name}: ${result.error} ${result.stderr} ${result.stdout}`,
                );
            }
        }
    };
}

function getAppFileName(context) {
    switch (context.electronPlatformName) {
        case 'win32': {
            const name = context.packager?.appInfo?.productFilename
                || context.packager?.executableName
                || context.packager?.appInfo?.productName
                || 'app';
            return `${name}.exe`;
        }
        case 'darwin':
        case 'mas':
            return `${context.packager.appInfo.productFilename}.app`;
        case 'linux':
            return context.packager.executableName || context.packager.appInfo.productFilename;
        default:
            return '';
    }
}

exports.default = async function afterPack(context) {
    try {
        const exePath = path.join(context.appOutDir, getAppFileName(context));

        await flipFuses(
            exePath,
            {
                version: FuseVersion.V1,
                [FuseV1Options.RunAsNode]: false,
                [FuseV1Options.EnableNodeCliInspectArguments]: false,
                [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
                [FuseV1Options.EnableCookieEncryption]: true,
                [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
                [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas',
                [FuseV1Options.OnlyLoadAppFromAsar]: true,
            });

        if (context.electronPlatformName === 'linux') {
            context.targets.forEach(fixSetuid(context));
        }
    } catch (error) {
        console.error('afterPack error: ', error);
        process.exit(1);
    }
};
