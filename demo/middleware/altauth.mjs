export function handler(wrapper) {
	console.log('Middleware: altauth');
    return wrapper.getHttpData().headers['authorization']?.toLowerCase() === 'test';
}

export default handler;