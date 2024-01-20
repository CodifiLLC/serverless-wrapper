import {ExpressWrapperContext} from './express-wrapper.mjs';
import {getData, AUTHORIZATION_MW_TYPE} from '@serverless-wrapper/parser';
import express from 'express';

const app = express();
app.use(express.json());
const port = 3000;

const functionData = getData();

// For any environmental variables defined in the config, set them in this shell's ENV
for (const key of functionData.envKeys) {
	process.env[key] = functionData.envMap[key];
}

const funcMap = {};

// Set up listeners for each function
for (const func of functionData.functions) {
	console.log('importing', func);

	// import the main function and any middleware that are defined for this endpoint
	Promise.all([
		import(func.indexPath),
		...func.middleware.map(mw => import(mw.path).then(f => ({type: mw.type, func: f.default})))
	]).then(([{main}, ...middleware]) => {
		//set up function map to be used by wrapper (to call from internally)
		funcMap[func.url] = main;

		//attach a listener to all methods for this URL
		app.all(func.url, async (req, res) => {
			const params = {
				...req.query,
				...req.body,
			};
			const http = {
				method: req.method,
				path: req.baseUrl + req.path,
				headers: req.headers
			};

			// Handle the OPTIONS method
			if (func.cors?.headers?.length) {
				res.setHeader('access-control-allow-headers', func.cors.headers.join(','));
			}
			if (func.cors?.headers?.length) {
				res.setHeader('access-control-allow-method', func.cors.methods.join(','));
			}
			if (func.cors?.headers?.length) {
				res.setHeader('access-control-allow-origin', func.cors.origins.join(','));
			}
			if (http.method === 'OPTIONS') {
				res.status(200).send();
				return;
			}
			//TODO get max runtime from express

			// Set up wrapper context obj
			const wrapper = new ExpressWrapperContext(http, params, funcMap);

			// Separate middleware between auth and non-auth functionality
			const authMiddleware = middleware.filter(mw => mw.type?.toLowerCase() === AUTHORIZATION_MW_TYPE);
			const defaultMiddleware = middleware.filter(mw => mw.type?.toLowerCase() !== AUTHORIZATION_MW_TYPE);

			// For each authorization middleware function run it. If it returns false, 401 the request
			for (const auth of authMiddleware) {
				const isAuthed = auth.func(wrapper);
				// console.log('got auth', isAuthed);
				if (!isAuthed) {
					res.status(401).send('Unauthorized');
					return;
				}
			}

			// For the rest of the middleware, run the function (passing the wrapper) and, if there are errors, 500
			try {
				for (const mw of defaultMiddleware) {
					mw.func(wrapper);
				}
			} catch (middlewareError) {
				res.status(500).send(middlewareError.message);
			}


			// Call the main function
			const funcResult = await main(wrapper);

			// For any headers returned by the function, set them on the response
			for (const [key, val] of Object.entries(funcResult.headers)) {
				res.setHeader(key, val);
			}

			// Return the status and body
			res.status(funcResult.status)
				.send(funcResult.body);
		});
	})
}

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`)
});
