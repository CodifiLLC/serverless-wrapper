import {ok} from '@serverless-wrapper/core';
import {randomStr} from "serverless-wrapper-lib/test.mjs";

export function main(wrapper) {
    console.log('has been run', wrapper.getRemainingRuntime());
    wrapper.invokeFunction('/test/health', {});
    return ok(`Hello, ${wrapper.getParams().name ?? 'world'}! Your val is ${randomStr()}`);
}