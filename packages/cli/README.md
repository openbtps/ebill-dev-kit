# @ebilladdress/cli

The `ebill` command for building apps and templates for the eBillAddress Marketplace.

```sh
npm install --global @ebilladdress/cli
ebill app init my-app
```

Requires Node.js 22.12 or later.

## Commands

| Command                                    | What it does                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ebill app init [dir] [--handle <handle>]` | Writes `ebill.app.toml`, `listing.toml`, `server.ts` and `README.md`. Never overwrites a file.              |
| `ebill app validate [dir] [--json]`        | Checks both TOML files and lists every problem                                                              |
| `ebill login`                              | Signs in as your organisation: an owner or admin approves the code it shows in eBill                        |
| `ebill logout`                             | Forgets the sign-in kept on this computer                                                                   |
| `ebill app deploy [--version <x.y.z>]`     | Checks your files locally, then pushes the version in `ebill.app.toml` through eBill's checks and to review |
| `ebill app versions`                       | Lists the app's versions and where review has them                                                          |
| `ebill app release <x.y.z>`                | Releases a version eBill approved                                                                           |
| `ebill app rollback <x.y.z>`               | Releases again a version that was released before                                                           |
| `ebill app status`                         | Shows the live version and what waits for review                                                            |
| `ebill app dev [--port <port>]`            | Installs the folder's app, checked but not reviewed, in your sandbox organisation, and signs its server in  |
| `ebill --version`, `ebill help [command]`  |                                                                                                             |

The app commands take `--dir <dir>` (default: the current folder) and find the app by the `client_id` in its `ebill.app.toml`, among your
organisation's apps. `deploy --version` is a safety check: it refuses unless the file says the same version.

A release moves every installation to the new version, except those whose organisation has not granted the new version's scopes. They stay
on the version they have until the organisation agrees.

## Developing against your sandbox

Your organisation's owners and admins make its sandbox in eBill's developer portal: a second organisation that reaches no real address.
`ebill app dev` then puts the folder's files through eBill's checks (all but the version going up), as your app's one dev version, and
installs it in the sandbox in place of the one before. It prints a link with a code: open it and your server trades the code at
`/oauth/token`, as for any install, for tokens that act in the sandbox alone.

eBill reaches your server at the https URLs in `ebill.app.toml`. On your own computer, point a tunnel (cloudflared, for one) at the port
your server listens on and use the tunnel's https URL there. Run `ebill app dev` again whenever you change the files. The dev version is
never reviewed, never released and never installed anywhere but your sandbox.

## Signing in

`ebill login` prints a link and a code. Open the link where you're signed in to eBill, check the code matches, and approve it. Only your
organisation's owners and admins can approve. The CLI then keeps a developer token for 90 days in `~/.config/ebill/credentials.json` (or
`$XDG_CONFIG_HOME/ebill`), readable by you alone. You can revoke it in eBill at any time.

In CI, set `EBILL_TOKEN` to a developer token instead. It takes the place of the saved sign-in. `EBILL_API_URL` points the CLI at another eBill
(default `https://api.ebilladdress.com`). It must be https, except for `localhost`. A saved sign-in is used only with the API it was made for.

## Validation

`ebill app validate` reports each problem with the check that failed, where, and why:

```text
2 problems in my-app:

  ebill.app.toml:app.kind  (allowed-value)
    must be one of: integration, template
  ebill.app.toml:webhooks.topics[0]  (topic-scope)
    "payment.answered" needs the "payments:read" scope in [access] scopes
```

It exits with 1 when there is a problem and 0 when there is none. `--json` prints `{ ok, failures: [{ check, path, reason }], skipped }`.

Checks that need the network (links open, images can be fetched, image sizes) are skipped and listed as skipped; eBill runs them when you deploy.

The full rules are in [CONTRACT.md](https://github.com/openbtps/ebill-dev-kit/blob/main/CONTRACT.md#app-files).

## Exit codes

- `0`: done
- `1`: something to fix, or a mistake in the command
- `2`: needs something eBill does not offer yet (no command does today)

## Licence

[MIT](LICENSE).
