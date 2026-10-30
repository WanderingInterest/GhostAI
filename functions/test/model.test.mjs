import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import OpenAI from "openai";
const require = createRequire(import.meta.url);
const { createExecutiveRunner } = require("../lib/agent/model.js");

test("Executive SDK serializes follow-up assistant history with typed message content", async () => {
  let wire;
  const generate = createExecutiveRunner(
    () =>
      new OpenAI({
        apiKey: "fixture-only",
        maxRetries: 0,
        fetch: async (_url, options) => {
          wire = JSON.parse(options.body);
          return new Response(
            JSON.stringify({
              id: "resp_fixture",
              object: "response",
              created_at: 0,
              status: "completed",
              model: "gpt-5.4-mini",
              output: [
                {
                  id: "msg_fixture",
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: "Here is your follow-up.",
                      annotations: [],
                    },
                  ],
                },
              ],
              usage: {
                input_tokens: 20,
                output_tokens: 8,
                total_tokens: 28,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      }),
  );
  const result = await generate({
    key: "fixture-only",
    model: "gpt-5.4-mini",
    instructions: "Answer briefly.",
    history: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hello back" },
      { role: "user", content: "Follow up" },
    ],
    tools: [],
    invoke: async () => {
      throw Error("No tools expected");
    },
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(result.text, "Here is your follow-up.");
  const previous = wire.input.find((item) => item.role === "assistant");
  assert.deepEqual(previous.content, [
    { type: "output_text", text: "Hello back", annotations: [] },
  ]);
  assert.equal(wire.store, false);
});
