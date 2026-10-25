// harbour-template, checked as `ebill app validate` checks it: its manifest, its listing and its template.json.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { validateApp } from "@ebilladdress/cli";

test("its manifest, listing and template pass every check `ebill app validate` makes", async () => {
  assert.deepEqual(await validateApp(fileURLToPath(new URL(".", import.meta.url))), []);
});
