import {ok} from '@serverless-wrapper/core';
import {randomStr} from "serverless-wrapper-lib/test.mjs";

export async function main(wrapper) {
    console.log('called health', wrapper.params);
    return ok({
        params: wrapper.params,
        randomStr: randomStr()
    });
}