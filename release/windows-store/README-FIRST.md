# ManeFlow Windows Store Release Candidate 2.20.0

This is the complete Microsoft Store packaging and listing kit for the hosted ManeFlow application:

`https://142df297558ace9e22.v2.appdeploy.ai/`

## What is complete

- Windows Store/PWA app icons, tile assets, splash art, Store logo, poster art, and hero art.
- Four desktop Store screenshots.
- Store listing copy and feature statements.
- Privacy, terms, support, age-rating, and certification-note drafts.
- A Windows packaging script based on Microsoft's current Microsoft Store Developer CLI.
- A draft-submission script that intentionally does not commit the submission.
- Production PWA manifest, service worker, and offline page files.
- Asset manifest and SHA-256 integrity report.

## The one external identity gate

A final Store-accepted `.msix`/`.msixbundle` cannot be generated truthfully until the ManeFlow product name is reserved in Microsoft Partner Center. The package must use the exact Product Identity values issued by Microsoft:

1. Product ID
2. Package ID
3. Publisher ID
4. Publisher display name

Do not invent these values. A package with mismatched identity will be rejected or will not update correctly.

## Build the Store package on Windows

1. Enroll the Microsoft account in the Windows Developer Program.
2. In Partner Center, create **New product > MSIX or PWA app** and reserve **ManeFlow**.
3. Open **Product management > Product identity** and copy the four values into `STORE-IDENTITY-REQUIRED.json` for your records.
4. Double-click `Build-Store-Package.cmd`.
5. Sign in/configure the Microsoft Store Developer CLI when prompted.
6. Select the reserved ManeFlow product when the CLI asks which Store application to associate.
7. The generated Store package will be placed under `Generated-Package`.

The Microsoft Store re-signs an accepted MSIX package. Customers installing from the Store will not see the unsigned-publisher warning that appeared with the earlier beta executable.

## Do not distribute this ZIP as the consumer installer

Consumers should install ManeFlow from its Microsoft Store product page after certification. This ZIP is the publisher release kit.
