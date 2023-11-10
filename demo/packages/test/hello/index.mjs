import {randomStr} from "serverless-wrapper-lib/test.mjs";

export async function main(params) {
    return {
        status: 200,
        body: `hello, ${params.name ?? 'world'}! Your val is ${randomStr()}`
    };
}