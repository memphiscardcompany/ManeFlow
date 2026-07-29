import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const appJson = readJson('apps/mobile-expo/app.json');
const easJson = readJson('apps/mobile-expo/eas.json');
const mobilePkg = readJson('apps/mobile-expo/package.json');
const desktopPkg = readJson('apps/desktop-electron/package.json');

const expo = appJson.expo || {};
assert(expo.name === 'ManeFlow', 'Expo app name must be ManeFlow.');
assert(mobilePkg.version.startsWith(expo.version), 'Expo app version must match the mobile package release line.');
assert(expo.icon && exists(`apps/mobile-expo/${expo.icon.replace('./', '')}`), 'Expo icon file is missing.');
assert(expo.splash?.image && exists(`apps/mobile-expo/${expo.splash.image.replace('./', '')}`), 'Expo splash file is missing.');
assert(expo.ios?.bundleIdentifier === 'com.memphiscardcompany.maneflow', 'iOS bundle id is not finalized.');
assert(expo.android?.package === 'com.memphiscardcompany.maneflow', 'Android package id is not finalized.');
assert(expo.ios?.infoPlist?.NSCameraUsageDescription?.includes('scan'), 'iOS camera permission copy is missing or vague.');
assert(expo.ios?.infoPlist?.NSPhotoLibraryUsageDescription?.includes('choose'), 'iOS selected-photo permission copy is missing or vague.');
assert((expo.android?.permissions || []).includes('CAMERA'), 'Android camera permission must be explicit.');
for (const broadPermission of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
  assert((expo.android?.blockedPermissions || []).some((permission) => permission.includes(broadPermission)), `Android broad media/storage permission is not blocked: ${broadPermission}`);
}
assert(easJson.cli?.appVersionSource === 'remote', 'EAS should use remote version source.');
assert(easJson.cli?.version === '16.32.0', 'EAS CLI must be pinned to the reviewed release-tool version.');
assert(easJson.cli?.requireCommit === true, 'Production EAS builds must require a committed Git source.');
assert(easJson.build?.production?.autoIncrement === true, 'Production EAS build must auto-increment store build numbers.');
assert(easJson.build?.production?.env?.EXPO_PUBLIC_API_BASE_URL === 'https://mane.memphiscardcompany.com', 'Production API URL must be the ManeFlow HTTPS domain.');
assert(!/sk-[A-Za-z0-9_-]{16,}/.test(JSON.stringify(appJson) + JSON.stringify(easJson)), 'Mobile config contains a secret-shaped value.');

assert(desktopPkg.version === mobilePkg.version, 'Desktop and mobile package versions must match.');
assert(desktopPkg.productName === 'ManeFlow', 'Desktop product name must be ManeFlow.');
assert(desktopPkg.author === 'Memphis Card Company', 'Desktop author metadata is missing.');
assert(desktopPkg.build?.appId === 'com.memphiscardcompany.maneflow.desktop', 'Desktop app id is missing.');
assert(desktopPkg.scripts?.['package:windows-store'], 'Microsoft Store packaging script is missing.');
assert(desktopPkg.build?.appx?.applicationId === 'ManeFlow', 'Microsoft Store AppX metadata is missing.');
assert(exists('apps/desktop-electron/assets/icon.png'), 'Desktop icon source PNG is missing.');
assert(!/secret|token|password/i.test(JSON.stringify(desktopPkg.build || {})), 'Desktop package config should not contain secret-like fields.');
const buildProperties = (expo.plugins || []).find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
assert(buildProperties?.[1]?.android?.targetSdkVersion === 36, 'Android targetSdkVersion must be 36.');
assert(buildProperties?.[1]?.android?.compileSdkVersion === 36, 'Android compileSdkVersion must be 36.');

for (const file of [
  'docs/STORE_DISTRIBUTION_CHECKLIST.md',
  'docs/MOBILE_RELEASE_PIPELINE.md',
  'docs/DESKTOP_RELEASE_PIPELINE.md',
  'docs/PRIVACY_DISCLOSURES.md',
  'apps/mobile-expo/store-metadata/ios.md',
  'apps/mobile-expo/store-metadata/android.md',
  'apps/desktop-electron/store-metadata/microsoft-store.md',
]) {
  assert(exists(file), `${file} is missing.`);
}

const checklist = read('docs/STORE_DISTRIBUTION_CHECKLIST.md');
for (const required of ['Apple Developer Program', 'Google Play Console', 'Microsoft Partner Center', 'authorized live completed-sale feeds', 'Values are estimates']) {
  assert(checklist.includes(required), `Store checklist missing: ${required}`);
}

console.log('Store distribution readiness metadata validated.');
