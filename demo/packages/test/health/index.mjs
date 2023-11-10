import {randomStr} from "serverless-wrapper-lib/test.mjs";

export async function main(params) {
    return {
        status: 200,
        body: {
            params,
            randomStr: randomStr()
        }
    }
}