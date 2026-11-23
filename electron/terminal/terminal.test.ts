import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { TerminalShellDescriptor } from "../../common/terminal";
import {
  encodeRecorderMarker,
  TerminalProtocolParser,
} from "./protocol";
import { discoverShells, selectDefaultShell } from "./shell-discovery";
import { prepareShellIntegration } from "./shell-integration";
import {
  listTerminalCommands,
  searchTerminalOutput,
} from "./artifacts";
import { TerminalTranscriptWriter } from "./transcript";

const NONCE = "recorded_terminal_nonce_1234";

test("terminal protocol removes only valid nonce-authenticated markers across chunks", () => {
  const parser = new TerminalProtocolParser(NONCE);
  const marker = encodeRecorderMarker(NONCE, {
    type: "command-start",
    id: "cmd-1",
    command: "printf 'hello world'",
    cwd: "/tmp/a b",
    shell: "bash",
    atMs: 1_000,
  });
  const split = Math.floor(marker.length / 2);
  assert.deepEqual(parser.push(`before${marker.slice(0, split)}`), [
    { type: "output", data: "before" },
  ]);
  assert.deepEqual(parser.push(`${marker.slice(split)}after`), [
    {
      type: "event",
      event: {
        type: "command-start",
        id: "cmd-1",
        command: "printf 'hello world'",
        cwd: "/tmp/a b",
        shell: "bash",
        atMs: 1_000,
      },
    },
    { type: "output", data: "after" },
  ]);

  const foreign = encodeRecorderMarker("different_nonce_123456", {
    type: "prompt-ready",
  });
  assert.deepEqual(parser.push(foreign), [{ type: "output", data: foreign }]);
});

test("shell discovery honors supported defaults without invoking a shell", () => {
  const files = new Set([
    "/custom/fish",
    "/custom/pwsh",
    "/bin/zsh",
    "C:\\Tools\\pwsh.exe",
  ]);
  const unix = discoverShells({
    platform: "darwin",
    env: { SHELL: "/custom/fish", PATH: "/bin:/custom" },
    fileExists: (candidate) => files.has(candidate),
  });
  assert.equal(unix[0].id, "fish");
  assert.equal(unix.some((shell) => shell.id === "pwsh"), true);
  assert.equal(
    selectDefaultShell(unix, {
      platform: "darwin",
      env: { SHELL: "/custom/fish" },
    })?.id,
    "fish",
  );
  assert.equal(
    selectDefaultShell(
      [{ id: "pwsh", displayName: "PowerShell", executable: "/custom/pwsh" }],
      { platform: "linux", env: {} },
    )?.id,
    "pwsh",
  );

  const windows = discoverShells({
    platform: "win32",
    env: { PATH: "C:\\Tools" },
    fileExists: (candidate) => files.has(candidate),
  });
  assert.equal(selectDefaultShell(windows, { platform: "win32" })?.id, "pwsh");
});

test("temporary shell integration chains but never modifies the real profile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "handover-shell-test-"));
  const home = path.join(root, "home");
  await mkdir(home);
  const profile = path.join(home, ".bashrc");
  await writeFile(profile, "export USER_SETTING=kept\n");
  const shell: TerminalShellDescriptor = {
    id: "bash",
    displayName: "Bash",
    executable: "/bin/bash",
  };
  try {
    const launch = await prepareShellIntegration(shell, {
      nonce: NONCE,
      homeDir: home,
      temporaryRoot: root,
      env: {},
    });
    assert.equal(await readFile(profile, "utf8"), "export USER_SETTING=kept\n");
    assert.equal(launch.executable, "/bin/bash");
    assert.deepEqual(launch.args.slice(0, 1), ["--rcfile"]);
    const wrapper = await readFile(launch.args[1], "utf8");
    assert.match(wrapper, /Handover generated shell integration/);
    assert.match(wrapper, /USER_SETTING|\.bashrc/);
    assert.match(wrapper, /HISTTIMEFORMAT= builtin history 1/);
    assert.match(wrapper, /HISTFILE=\/dev\/null/);
    assert.match(wrapper, /__sr_user_prompt_commands=\("\$\{PROMPT_COMMAND\[@\]\}"\)/);
    await launch.cleanup();
    await assert.rejects(readFile(launch.args[1], "utf8"));

    const powerShell = await prepareShellIntegration(
      {
        id: "pwsh",
        displayName: "PowerShell",
        executable: "/custom/pwsh",
      },
      {
        nonce: NONCE,
        homeDir: home,
        temporaryRoot: root,
        env: {},
      },
    );
    const powerShellWrapper = await readFile(powerShell.args.at(-1)!, "utf8");
    assert.match(powerShellWrapper, /__srPromptCommand\.ScriptBlock/);
    assert.doesNotMatch(powerShellWrapper, /__srPriorPrompt\.ScriptBlock/);
    assert.doesNotMatch(powerShellWrapper, /__srPriorReadLine\.ScriptBlock/);
    await powerShell.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transcript persists full output and an indexed command range", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "handover-terminal-test-"));
  try {
    const commands: string[] = [];
    const writer = new TerminalTranscriptWriter({
      sessionDir: root,
      sessionStartedAt: 10_000,
      onCommand: ({ index }) => commands.push(index.id),
    });
    writer.appendOutput("prompt$ ", 10_050);
    writer.startCommand({
      type: "command-start",
      id: "cmd-1",
      command: "printf secret-result",
      cwd: "/work",
      shell: "bash",
      atMs: 10_100,
    });
    writer.appendOutput("secret-result\r\n", 10_125);
    writer.finishCommand({
      type: "command-finish",
      id: "cmd-1",
      exitCode: 0,
      atMs: 10_175,
    });
    await writer.close(10_200);

    assert.deepEqual(commands, ["cmd-1"]);
    const page = await listTerminalCommands(root);
    assert.equal(page.commands.length, 1);
    assert.equal(page.commands[0].durationMs, 75);
    assert.equal(page.commands[0].exitCode, 0);
    assert(
      page.commands[0].transcriptEndByte >
        page.commands[0].transcriptStartByte,
    );

    const output = await searchTerminalOutput(root, {
      commandId: "cmd-1",
      query: "secret-result",
    });
    assert.equal(output.hits.length, 1);
    assert.match(output.hits[0].text, /secret-result/);
    assert.equal(output.hits[0].commandId, "cmd-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closing a transcript marks an active command interrupted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "handover-terminal-test-"));
  try {
    const writer = new TerminalTranscriptWriter({
      sessionDir: root,
      sessionStartedAt: 1_000,
    });

    writer.startCommand({
      type: "command-start",
      id: "cmd-running",
      command: "long-task",
      cwd: "/work",
      shell: "zsh",
      atMs: 1_100,
    });
    writer.appendOutput("still running", 1_200);
    await writer.close(1_250);
    const page = await listTerminalCommands(root);
    assert.equal(page.commands[0].interrupted, true);
    assert.equal(page.commands[0].exitCode, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
