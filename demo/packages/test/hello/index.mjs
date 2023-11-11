import {ok} from '@serverless-wrapper/core';
import {randomStr} from "serverless-wrapper-lib/test.mjs";

export async function main(wrapper) {
    console.log('has been run', wrapper.getRemainingRuntime());
    return ok(`hello, ${wrapper.getParams().name ?? 'world'}! Your val is ${randomStr()}`);
}