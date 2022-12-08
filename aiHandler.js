(function () {
    'use strict';

    const rp = require('request-promise');
    const logger = require('../utils/logger');
    const responseFormatter = require('../utils/responseFormatter');
    const userSchema = require('../schema/userSchema');

    let handler = {};

    handler.trainModel = async (request, h) => {
        let status;
        const options = {
            method: 'POST',
            uri: 'https://ai.ezjobs.io/classify/',
            json: true
        };

        try {
            status = await rp(options);
        } catch (e) {
            logger.error('error occurred while training model %s', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while training the model.', 'error', 500)).code(500);
        }

        return h.response(responseFormatter.responseFormatter({}, 'Model trained successfully.', 'success', 200)).code(200);
    };

    handler.getRecommendations = async (request, h) => {
        let checkUser, checkJob;

        if (request.query.isUser && !request.query.userId) {
            return h.response(responseFormatter.responseFormatter({}, 'Please provide User ID.', 'error', 400)).code(400);
        }
        if (request.query.isJob && !request.query.jobId) {
            return h.response(responseFormatter.responseFormatter({}, 'Please provide Job ID.', 'error', 400)).code(400);
        }

        if (request.query.userId) {
            try {
                checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding user in get recommendation handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!checkUser) {
                return h.response(responseFormatter.responseFormatter({}, 'No such user.', 'error', 404)).code(404);
            }
            let corpus = checkUser.employeeInformation.description.text + ',' + checkUser.employeeInformation.skillsLower.toString() + ',' + checkUser.employeeInformation.pastJobTitles.toString();

            let recommendations;
            const options = {
                method: 'GET',
                uri: 'https://ai.ezjobs.io/classify/?sound=' + corpus,
                json: true
            };

            try {
                recommendations = await rp(options);
            } catch (e) {
                logger.error('error occurred while getting recommendation model %s', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while training the model.', 'error', 500)).code(500);
            }

            return h.response(responseFormatter.responseFormatter(recommendations, 'Fetched successfully', 'success', 200)).code(200);
        }
    };

    module.exports = {
        aiHandler: handler
    }

})();
