---
title: Versions and review
---

# Versions and review

Each change to your app, its manifest or its listing, is a new **version**, `x.y.z`, higher than the last. A version goes through
eBillAddress's checks, then a person at eBillAddress reviews it, then you release it.

## 1. Push: the automatic checks

`ebill app deploy` checks your files on your computer first, then pushes them. eBillAddress runs the same checks as
`ebill app validate`, and the ones that need the network:

- your support, privacy and terms links open;
- each listing image can be fetched, up to 5 MB, and is a PNG, JPEG or WebP by its own bytes;
- the icon is 512 × 512, the cover 1600 × 900, and each screenshot between 640 × 400 and 3840 × 2400.

eBillAddress keeps its own copy of each image and shows only that, never your link. A push that fails a check is refused, stores
nothing, and says what failed in the same `{ check, path, reason }` shape `ebill app validate --json` prints.

## 2. Review

A version that passes waits for review (`review_pending`). A person at eBillAddress looks at what it changes against the version
live now, and checks that:

- each permission is needed for something the listing says the app does;
- the name, description and screenshots don't suggest eBillAddress made, verifies or endorses the app, or imitate a trust label;
- the content is appropriate and the category right;
- the privacy policy says the app deletes an organisation's synced data within 30 days of being removed;
- the app works: installed in a test organisation, used once, removed, its access then gone.

They approve it (`approved`), or ask for changes with a reason you read with `ebill app versions` (`changes_requested`).

## 3. Release

`ebill app release x.y.z` releases an approved version. The version before is `superseded`, and installations move to the new one
(see [Organisations and installations](./installations.md#updates)). `ebill app rollback x.y.z` releases again a version that was
released before.

A template version can also be `retired` by eBillAddress: documents drawn with it then fall back to the standard view.

## A version's states

| State               | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `review_pending`    | passed the checks, waiting for review                        |
| `changes_requested` | review sent it back, with a reason                           |
| `approved`          | ready to release                                             |
| `released`          | the version organisations install                            |
| `superseded`        | released before; can be rolled back to                       |
| `retired`           | a template version eBillAddress withdrew                     |
| `dev`               | your one dev version, in your sandbox only (`ebill app dev`) |
