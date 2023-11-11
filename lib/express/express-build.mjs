import {getData, LocalWrapperContext} from '@serverless-wrapper/core';
import express from 'express';
const app = express();
app.use(express.json());
const port = 3000;

const functionData = getData();

const authMiddleware = [];
for (const middleware of functionData.middleware) {
    const mw = await import(middleware.path);

    if (middleware.type === 'authorization') {
        authMiddleware.push(mw.default);
    }
}

for (const func of functionData.functions) {
    console.log('importing', func);
    import(func.indexPath).then(({main}) => {
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
            //TODO get max runtime from express
            const wrapper = new LocalWrapperContext(http, params);

            for (const auth of authMiddleware) {
                const isAuthed = auth(wrapper);
                if (!isAuthed) {
                    res.status(401).send('Unauthorized');
                    return;
                }
            }

            const funcResult = await main(wrapper);
            for (const [key, val] of Object.entries(funcResult.headers)) {
                res.setHeader(key, val);
            }
            res.status(funcResult.status)
                .send(funcResult.body);
        });
    })
}

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});