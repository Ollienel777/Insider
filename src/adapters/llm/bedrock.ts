// Bedrock through `@langchain/aws` (SPEC §4.5): present, but refused unless
// `BEDROCK_ENABLED=1`, so a stray `LLM_PROVIDER=bedrock` cannot start billing
// an AWS account.
//
// Not exercised against Bedrock: there are no AWS credentials here.
import { ChatBedrockConverse } from "@langchain/aws";
import { MAX_TOKENS } from "./anthropic";
import { LlmConfigurationError, type LlmRole } from "./types";

export const BEDROCK_DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";
export const BEDROCK_DEFAULT_REGION = "us-east-1";

type Env = Record<string, string | undefined>;

export function assertBedrockEnabled(env: Env): void {
  if (env.BEDROCK_ENABLED !== "1") {
    throw new LlmConfigurationError(
      "LLM_PROVIDER=bedrock, but Bedrock is disabled: set BEDROCK_ENABLED=1 to allow Bedrock calls, " +
        "or set LLM_PROVIDER=anthropic",
    );
  }
}

export function createBedrockModel(role: LlmRole, env: Env): ChatBedrockConverse {
  assertBedrockEnabled(env);
  return new ChatBedrockConverse({
    model: env.BEDROCK_MODEL_ID || BEDROCK_DEFAULT_MODEL,
    region: env.AWS_REGION || BEDROCK_DEFAULT_REGION,
    maxTokens: MAX_TOKENS[role],
  });
}
