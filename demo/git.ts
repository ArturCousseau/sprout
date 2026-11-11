/**
 * Environment for every git command of the demo (D7): `base` plus variables
 * that hide the user's global and system config, and that make git fail
 * instead of waiting for a password or confirmation on the terminal.
 */
export function gitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * Config written into each agent's clone (`git config <key> <value>`), so
 * commits work without any global config (D7). `gc.auto=0` keeps git from
 * starting a garbage collection in the middle of a run.
 */
export function localGitConfig(agent: number): [key: string, value: string][] {
  return [
    ["user.name", `agente-${agent}`],
    ["user.email", `agente-${agent}@example.invalid`],
    ["commit.gpgsign", "false"],
    ["gc.auto", "0"],
  ];
}
