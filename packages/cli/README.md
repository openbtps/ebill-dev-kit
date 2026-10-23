# @ebilladdress/cli

The `ebill` command for building apps and templates for the eBillAddress Marketplace.

```sh
npm install --global @ebilladdress/cli
ebill app init my-app
```

Requires Node.js 22.12 or later.

## Commands

| Command                                            | What it does                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ebill app init [dir] [--handle <handle>]`         | Writes `ebill.app.toml`, `listing.toml`, `server.ts` and `README.md`. Never overwrites a file. |
| `ebill app validate [dir] [--json]`                | Checks both TOML files and lists every problem                                                 |
| `ebill login`                                      | Sign in to your developer account                                                              |
| `ebill app dev [--port <port>]`                    | Run your app against eBill while you develop                                                   |
| `ebill app deploy --version <x.y.z> --message <m>` | Upload a version. It checks your files locally first                                           |
| `ebill app versions`                               | List deployed versions                                                                         |
| `ebill app release <x.y.z> [--at <iso time>]`      | Release a version, now or at a set time                                                        |
| `ebill app rollback <x.y.z>`                       | Go back to an earlier version                                                                  |
| `ebill app status`                                 | Live version, scheduled release, review state                                                  |
| `ebill --version`, `ebill help [command]`          |                                                                                                |

`login`, `dev`, `deploy`, `versions`, `release`, `rollback` and `status` need the eBill developer API, which is coming soon. Until then they check
their arguments, print a message saying so, and exit with code 2.

## Validation

`ebill app validate` reports each problem with the check that failed, where, and why:

```text
2 problems in my-app:

  ebill.app.toml:app.kind  (allowed-value)
    must be one of: integration, template
  ebill.app.toml:webhooks.topics[0]  (topic-scope)
    "payment.accepted" needs the "payments:read" scope in [access] scopes
```

It exits with 1 when there is a problem and 0 when there is none. `--json` prints `{ ok, failures: [{ check, path, reason }], skipped }`.

Checks that need the network (links open, images can be fetched, image sizes) are skipped and listed as skipped; eBill runs them when you deploy.

The full rules are in [CONTRACT.md](https://github.com/openbtps/ebill-dev-kit/blob/main/CONTRACT.md#app-files).

## Exit codes

- `0`: done
- `1`: something to fix, or a mistake in the command
- `2`: needs the eBill developer API, which is not available yet

## Licence

To be announced.
