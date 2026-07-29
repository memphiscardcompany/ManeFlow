# ManeFlow Final Beta Testing Runbook

## Testers

- Owner workstation: normal ManeFlow operations and owner curation
- Ricoh bulk tester: high-volume duplex imports and corrections

## Before installation

1. Verify the SHA-256 checksum.
2. Record Windows version, CPU, RAM, available disk, scanner model, and scanner software version.
3. Use a rotated PSA key; never reuse an exposed credential.
4. Back up existing card images and exports.

## Installation test

- install to default directory
- launch from installer
- close/reopen
- reboot and reopen
- verify app data survives update/reinstall
- verify uninstall leaves user data intact
- record SmartScreen/Defender warnings

## Functional matrix

### Single card

- raw front only
- raw front/back
- PSA/BGS/SGC/CGC slab
- chrome/foil glare
- serial-number closeup
- unknown card must remain unresolved rather than fabricate identity

### Multiple/mixed cards

- 2–10 non-overlapping cards
- overlapping table spread
- raw + slab + toploader
- duplicate copies
- same card across several lot photos
- partial/hidden cards

### Ricoh

- filename front/back markers
- alternating duplex files
- numeric filenames containing 1, 2, 10, 11
- odd file count
- blank/misfeed page
- rotated page
- 100, 500, 1,000, and 5,000 physical-card batches
- stop/restart during processing
- duplicate folder import
- CSV export

### Learning data

- private contributor creates no training example
- labels-only contributor exports no images
- images-and-labels contributor exports allowed images
- imported pack returns to pending owner review
- rejection excludes matching/training
- approval enters dataset manifest
- private financial/seller fields never appear
- stable split remains identical across repeated manifest exports
- revoke locally and confirm examples disappear from active use

### Lot economics

- BIN + shipping + tax
- repeated card across listing images counted once
- conservative/expected/optimistic values
- no verified comps returns unpriced/unverifiable
- fees and outbound shipping included

## Performance records

For each batch, record:

- source image count
- physical items paired
- import time
- processing time
- peak memory
- exact identity rate
- correct candidate in top 3
- variant/parallel accuracy
- false-confident error count
- manual correction count
- scanner mispair count

## Beta stop conditions

Stop distribution and open a blocker when:

- private data appears in contribution output
- wrong cards are assigned high confidence repeatedly
- front/back files are paired to different physical cards
- data is lost after restart/update
- local services become reachable outside loopback
- pricing is displayed as verified without authorized sold comps
- installer is quarantined or fails on clean Windows systems

## Bug report bundle

Include:

- steps to reproduce
- screenshots
- batch ID and item sequence number
- original scan filenames
- app version
- logs from the ManeFlow Logs folder
- whether provider credentials were configured
- permission to share the affected card images with the owner
