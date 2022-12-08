'use strict';
const codeSchema = require('../schema/codeSchema');
const responseFormatter = require('../utils/responseFormatter');

let handlers = {};

handlers.getStateCodes = async (request, h) => {

    let getCodes = () => {
        return new Promise((resolve, reject) => {
            codeSchema.CodeSchema.find({}, {}, {lean: true}, (err, codes) => {
                if (err) {
                    reject(err);
                }
                resolve(codes);
            })
        })
    };
    try {
        const codes = await getCodes();
        return h.response(responseFormatter.responseFormatter(codes, 'Fetched Successfully', 'success', 200));
    } catch (e) {
        if (e.name === 'MongoError' && e.code === 11000) {
            return h.response(responseFormatter.responseFormatter({}, 'Internal server error', 'error', 500));
        }
    }
};

module.exports = {
    Handlers: handlers
};
