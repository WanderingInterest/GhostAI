import {
  Agent,
  assistant,
  user,
  OpenAIProvider,
  Runner,
  tool,
} from "@openai/agents";
import OpenAI from "openai";
import { ToolDefinition } from "./tools";
import { AppError } from "../contracts";

export type ModelInput = {
  key: string;
  model: string;
  instructions: string;
  history: { role: "user" | "assistant"; content: string }[];
  tools: ToolDefinition[];
  invoke: (name: string, args: unknown) => Promise<unknown>;
  signal: AbortSignal;
};
export type ModelOutput = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
};
export type RunExecutive = (input: ModelInput) => Promise<ModelOutput>;

export function createExecutiveRunner(
  clientForKey: (key: string) => OpenAI = (key) =>
    new OpenAI({ apiKey: key, maxRetries: 0, timeout: 40000 }),
): RunExecutive {
  return async (input) => {
    // Per-invocation client: no global API key, mutable tenant client, provider
    // conversation, or automatic HTTP retry that could repeat paid generation.
    const client = clientForKey(input.key);
    const provider = new OpenAIProvider({
      openAIClient: client,
      useResponses: true,
    });
    const runner = new Runner({
      modelProvider: provider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
    const executive = new Agent({
      name: "GhostAI Executive",
      instructions: input.instructions,
      model: input.model,
      modelSettings: {
        store: false,
        parallelToolCalls: false,
        maxTokens: 1400,
      },
      tools: input.tools.map((definition) =>
        tool({
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
          execute: (args) => input.invoke(definition.name, args),
          errorFunction: (_context, error) =>
            error instanceof AppError
              ? JSON.stringify({ status: "rejected", message: error.message })
              : "The tool could not complete. Do not assume the action succeeded or retry it automatically.",
        }),
      ),
    });
    try {
      const result = await runner.run(
        executive,
        input.history.map((message) =>
          message.role === "assistant"
            ? assistant(message.content)
            : user(message.content),
        ),
        { maxTurns: 12, signal: input.signal },
      );
      return {
        text: String(result.finalOutput ?? ""),
        inputTokens: result.state.usage.inputTokens,
        outputTokens: result.state.usage.outputTokens,
        requests: result.state.usage.requests,
      };
    } finally {
      await provider.close();
    }
  };
}
export const runExecutive = createExecutiveRunner();
