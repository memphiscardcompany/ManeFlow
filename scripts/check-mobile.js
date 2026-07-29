import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appJsonPath = path.join(root, 'apps', 'mobile-expo', 'app.json');
const packageJsonPath = path.join(root, 'apps', 'mobile-expo', 'package.json');
const appPath = path.join(root, 'apps', 'mobile-expo', 'App.tsx');

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const appSource = fs.readFileSync(appPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expo = appJson.expo || {};
const publicVersion = String(release.version).match(/^\d+\.\d+\.\d+/)?.[0];
assert(expo.version === publicVersion, `Expo app version ${expo.version} must match release version ${publicVersion}.`);
assert(packageJson.version === release.version, `Mobile package version ${packageJson.version} must match root release ${release.version}.`);
assert(expo.ios?.bundleIdentifier === 'com.memphiscardcompany.maneflow', 'iOS bundle identifier is not finalized.');
assert(expo.android?.package === 'com.memphiscardcompany.maneflow', 'Android package identifier is not finalized.');
assert(expo.extra?.apiBaseUrl?.startsWith('https://'), 'Production API URL must use HTTPS.');
assert(expo.extra?.stagingApiBaseUrl?.startsWith('https://'), 'Staging API URL must use HTTPS.');
assert(expo.ios?.infoPlist?.NSCameraUsageDescription?.includes('scan'), 'iOS camera permission copy is missing.');
assert(expo.ios?.infoPlist?.NSPhotoLibraryUsageDescription?.includes('choose'), 'iOS selected-photo permission copy is missing.');
for (const permission of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
  assert((expo.android?.blockedPermissions || []).some((item) => item.includes(permission)), `Android broad media/storage permission is not blocked: ${permission}`);
}
assert(!/sk-[A-Za-z0-9_-]{16,}/.test(JSON.stringify(expo.extra || {})), 'Mobile config contains a secret-shaped value.');

const buildProperties = (expo.plugins || []).find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
assert(buildProperties?.[1]?.android?.compileSdkVersion === 36, 'Android compile SDK must be 36.');
assert(buildProperties?.[1]?.android?.targetSdkVersion === 36, 'Android target SDK must be 36.');
assert(Number(expo.android?.versionCode || 0) >= 17, 'Android versionCode must be release-ready.');
assert(Number(expo.ios?.buildNumber || 0) >= 15, 'iOS buildNumber must be release-ready.');

for (const required of ['ScanTrustCard', 'ValueTrustCard', 'dealer-decision', 'gradedCert', 'scanConfidence', 'certDataUrl', 'certData', 'recognition']) {
  assert(appSource.includes(required), `Mobile app is missing ${required}.`);
}

console.log(`Mobile Expo ${packageJson.version} configuration validated.`);
