import {ok} from '@serverless-wrapper/core';
import {randomStr} from "serverless-wrapper-lib/test.mjs";

export async function main(wrapper) {
    return ok({
        params: wrapper.getParams(),
        randomStr: randomStr()
    });
}