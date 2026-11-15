import {ChatOpenAICompletions,ChatOpenAIResponses} from '@langchain/openai';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {modelContextWindow} from '../../contracts/src/model-context';
const declarations=new WeakMap<object,number>();
export const declaredModelContextWindow=(model:BaseChatModel):number|undefined=>declarations.get(model);
/** Override only the integration's public profiling getter. Calls, streams,
 * token counters and errors still belong to the official model implementation. */
export class ContextualChatCompletions extends ChatOpenAICompletions{
 constructor(fields:ConstructorParameters<typeof ChatOpenAICompletions>[0],window?:number){super(fields);if(window!==undefined)declarations.set(this,modelContextWindow.parse(window));}
 override get profile(){const window=declarations.get(this);return window===undefined?super.profile:{...super.profile,maxInputTokens:window};}
}
export class ContextualChatResponses extends ChatOpenAIResponses{
 constructor(fields:ConstructorParameters<typeof ChatOpenAIResponses>[0],window?:number){super(fields);if(window!==undefined)declarations.set(this,modelContextWindow.parse(window));}
 override get profile(){const window=declarations.get(this);return window===undefined?super.profile:{...super.profile,maxInputTokens:window};}
}
