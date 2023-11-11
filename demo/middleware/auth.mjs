export function handler(wrapper) {
    return !!wrapper.getHttpData().headers['authorization'];
}

export default handler;