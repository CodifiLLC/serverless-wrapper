export function handler(wrapper) {
	console.log('Middleware: logging', wrapper.getParams());
}

export default handler;