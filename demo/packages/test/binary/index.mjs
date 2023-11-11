import {readFileSync} from 'fs';
import {binary} from '@serverless-wrapper/core';

console.log('importing binary function');

export async function main(wrapper) {
    const bodyFile = readFileSync(new URL('dummy.pdf', import.meta.url).toString().replace('file://', ''));
    return binary(bodyFile, 'application/pdf', {}, 'test.pdf');
}
