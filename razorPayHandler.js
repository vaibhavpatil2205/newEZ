(function () {
    'use strict';

    const rzrPay = require('../utils/paymentGatewayRzrpy');
    const responseFormatter = require('../utils/responseFormatter');
    const userSchema = require('../schema/userSchema');
    const logger = require('../utils/logger');
    const commonFunctions = require('../utils/commonFunctions');
    const packageSchema = require('../schema/packageSchema');
    const subscriptionSchema = require('../schema/subscriptionSchema');
    const mongoose = require('mongoose');
    const jobSchema = require('../schema/jobSchema');
    const favouriteSchema = require('../schema/favouriteSchema');
    const adminSchema = require('../schema/adminSchema');
    const conversationSchema = require('../schema/conversationSchema');
    const notificationSchema = require('../schema/notificationSchema');
    const constantSchema = require('../schema/constantSchema');
    const promoSchema = require('../schema/promoCodeSchema');
    const codeSchema = require('../schema/codeSchema');
    const push = require('../utils/push');
    const moment = require('moment-timezone');
    const mandrill = require('../utils/mandrill');
    const subscriptionRenewalSchema = require('../schema/subscriptionRenewal');

    let handler = {};

    handler.createCustomer = async (request, h) => {
        let customer;

        customer = await rzrPay.Handler.createCustomer(request.payload.name, request.payload.email, '', {});

        if (customer.statusCode && customer.statusCode !== 200) {
            return h.response(responseFormatter.responseFormatter({}, customer.error.error.description, 'error', customer.statusCode)).code(customer.statusCode);
        }

        return h.response(responseFormatter.responseFormatter(customer, 'Customer created', 'success', 201)).code(200);
    };

    handler.createPlan = async (request, h) => {
        let plan;

        plan = await rzrPay.Handler.createPlan(request.payload.period, request.payload.interval, request.payload.name, request.payload.description, request.payload.amount, request.payload.currency, request.payload.notes);

        if (plan.statusCode && plan.statusCode !== 200) {
            return h.response(responseFormatter.responseFormatter({}, plan.error.error.description, 'error', plan.statusCode)).code(plan.statusCode);
        }

        return h.response(responseFormatter.responseFormatter(plan, 'Plan created', 'success', 201)).code(200);
    };

    handler.createSubscription = async (request, h) => {
        let subscription, checkUser, decoded, checkPlan, searchCriteria, planId, checkSubscription, activeJobs, existingSubscription, order, currency, constantData, taxBracket = {};

        /* Check if user exists in database */
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user information in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
        } else if (checkUser.isSlave) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to purchase subscription package. Please contact your account admin.', 'error', 400)).code(400);
        }

        /* Check whether access token is valid */
        try {
            decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
        } catch (e) {
            logger.error('Error occurred decoding token in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (decoded.userId !== checkUser._id.toString()) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
        }

        /* Check whether subscription exists already for the same user */
        try {
            existingSubscription = await subscriptionSchema.subscriptionSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userId), isFree: false, isActive: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding existing subscription in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!request.payload.isExtend) {
            if (existingSubscription && existingSubscription.isActive) {
                return h.response(responseFormatter.responseFormatter({}, 'You have already purchased a subscription.', 'error', 400)).code(400);
            }
        }

        if (request.payload.country) {
            try {
                currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in getting currency data in create pricing handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }

        /* Get the constant data for getting tax numbers */
        try {
            constantData = await constantSchema.constantSchema.findOne({}, {taxes: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding constant data in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Check whether plan exists */
        if (request.payload.planType.toLowerCase() === 'yearly') {
            searchCriteria = {
                planIdAnnually: request.payload.planId
            }
        } else {
            searchCriteria = {
                planIdMonthly: request.payload.planId
            }
        }
        try {
            checkPlan = await packageSchema.packageSchema.findOne(searchCriteria, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding packageF information in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkPlan) {
            return h.response(responseFormatter.responseFormatter({}, 'Plan invalid', 'error', 400)).code(400);
        }
        planId = checkPlan._id;

        /* Get tax bracket */
        if (request.payload.country) {
            const taxIndex = constantData.taxes.findIndex(k => k.country.toLowerCase() === request.payload.country.toLowerCase());
            if (taxIndex !== -1) {
                taxBracket = constantData.taxes[taxIndex];
            } else {
                taxBracket = {
                    taxType: 'NA',
                    taxAmount: 0
                }
            }
        }

        let startAt, expiresAt;
        if (!request.payload.isOneTime && checkPlan.trialPeriod) {
            const tempDate = new Date(moment.tz("America/New_York").add(checkPlan.trialPeriod, 'days'));
            if (checkUser.trialPeriodUsed) {
                startAt = undefined;
                if (request.payload.planType === 'yearly') {
                    expiresAt = new Date(moment.tz("America/New_York").add(1, 'years'));
                } else {
                    expiresAt = new Date(moment.tz("America/New_York").add(1, 'months'));
                }
            } else {
                startAt = commonFunctions.Handlers.calculateTrialPeriod(checkPlan.trialPeriod);
                if (request.payload.planType === 'yearly') {
                    expiresAt = new Date(moment(tempDate).add(1, 'years'));
                } else {
                    expiresAt = new Date(moment(tempDate).add(1, 'months'));
                }
            }
        } else {
            if (request.payload.planType.toLowerCase() === 'yearly') {
                expiresAt = new Date(moment.tz("America/New_York").add(1, 'years'));
            } else {
                expiresAt = new Date(moment.tz("America/New_York").add(1, 'months'));
            }
        }

        const notes = {
            customerId: checkUser._id,
            customerName: checkUser.firstName + ' ' + checkUser.lastName,
            email: checkUser.email,
            phone: checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'NA'
        };

        let amount;
        if (request.payload.isOneTime) {
            let checkPromoCode;
            if (request.payload.promoCode) {
                try {
                    checkPromoCode = await promoSchema.promoCodeSchema.findOne({promoCode: request.payload.promoCode, planType: request.payload.planType.toLowerCase()}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred finding promo code information in create subscription handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!checkPromoCode || !checkPromoCode.count) {
                    return h.response(responseFormatter.responseFormatter({}, 'Promo is not valid.', 'error', 400)).code(400);
                } else if (checkPromoCode.planType.toLowerCase() !== request.payload.planType.toLowerCase()) {
                    return h.response(responseFormatter.responseFormatter({}, 'Promo is not valid.', 'error', 400)).code(400);
                } else {
                    if (currency.currencyName !== checkPromoCode.currency) {
                        return h.response(responseFormatter.responseFormatter({}, 'Promo is not valid.', 'error', 400)).code(400);
                    }
                   /* if (request.payload.promoCode.toLowerCase() === 'ez500') {
                        amount = 500;
                        expiresAt = new Date(moment.tz("America/New_York").add(10, 'days'));
                    } else {

                    }*/
                    amount = request.payload.planType.toLowerCase() === 'monthly' ? checkPlan.totalMonthlyBeforeTax : checkPlan.totalYearlyBeforeTax;
                    if (checkPromoCode.promoType === 'fixed') {
                        amount = amount - checkPromoCode.amount;
                    } else {
                        amount = amount * (1 - (checkPromoCode.amount / 100));
                    }
                }
            } else {
                amount = request.payload.planType.toLowerCase() === 'monthly' ? checkPlan.totalMonthlyBeforeTax : checkPlan.totalYearlyBeforeTax;
            }
            amount = amount * (1 + (taxBracket.taxAmount / 100));

            amount = amount.toFixed(2) * 100;
            order = await rzrPay.Handler.createOrder(amount, currency.currencyName, notes);
            if (order.statusCode && order.statusCode !== 200) {
                return h.response(responseFormatter.responseFormatter({}, order.error.error.description, 'error', order.statusCode)).code(order.statusCode);
            }
        } else {
            subscription = await rzrPay.Handler.createSubscription(request.payload.planId, request.payload.planType.toLowerCase() === 'yearly' ? 10 : 120, 0, notes, startAt);
            if (subscription.statusCode && subscription.statusCode !== 200) {
                return h.response(responseFormatter.responseFormatter({}, subscription.error.error.description, 'error', subscription.statusCode)).code(subscription.statusCode);
            }
        }

        /* Get posted jobs */
        try {
            activeJobs = await jobSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(request.payload.userId), isArchived: false, isTranslated: false, isVisible: true});
        } catch (e) {
            logger.error('Error occurred finding active jobs count information in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Save subscription in database */
        delete checkPlan._id;
        let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPlan);
        delete subscriptionToSave.createdAt;
        delete subscriptionToSave.updatedAt;
        subscriptionToSave.isActive = false;
        subscriptionToSave.userId = request.payload.userId;
        subscriptionToSave.planId = request.payload.planId;
        subscriptionToSave.planType = request.payload.planType;
        subscriptionToSave.razorSubscriptionId = subscription ? subscription.id : '';
        subscriptionToSave.packageId = planId;
        subscriptionToSave.numberOfJobs.count = (request.payload.planType === 'yearly' ? checkPlan.numberOfJobs.yearlyCount : checkPlan.numberOfJobs.monthlyCount) - activeJobs;
        subscriptionToSave.numberOfUsers.count = request.payload.planType === 'yearly' ? checkPlan.numberOfUsers.yearlyCount : checkPlan.numberOfUsers.monthlyCount;
        subscriptionToSave.numberOfViews.count = request.payload.planType === 'yearly' ? checkPlan.numberOfViews.yearlyCount : checkPlan.numberOfViews.monthlyCount;
        subscriptionToSave.numberOfTextTranslations.count = request.payload.planType === 'yearly' ? checkPlan.numberOfTextTranslations.yearlyCount : checkPlan.numberOfTextTranslations.monthlyCount;
        subscriptionToSave.numberOfJobTranslations.count = request.payload.planType === 'yearly' ? checkPlan.numberOfJobTranslations.yearlyCount : checkPlan.numberOfJobTranslations.monthlyCount;
        subscriptionToSave.jobsInAllLocalities.count = checkPlan.jobsInAllLocalities.count;
        subscriptionToSave.startAt = startAt ? startAt : undefined;
        subscriptionToSave.expiresAt = expiresAt ? expiresAt : undefined;
        subscriptionToSave.orderId = order ? order.id : '';
        subscriptionToSave.taxAmount = taxBracket ? taxBracket.taxAmount : 0;
        subscriptionToSave.taxType = taxBracket ? taxBracket.taxType : '';
        subscriptionToSave.promoCode = request.payload.promoCode;
        subscriptionToSave.isPromoApplied = !!request.payload.promoCode;
        subscriptionToSave.chargeAt = subscription ? subscription.charge_at : new Date();
        subscriptionToSave.chargeAtDate = subscription ? new Date(subscription.charge_at * 1000) : new Date();
        subscriptionToSave.totalAmountPaid = subscription ? (request.payload.planType.toLowerCase() === 'monthly' ? checkPlan.totalMonthly : checkPlan.totalYearly) : (amount / 100);
        subscriptionToSave.isExtend = !!request.payload.isExtend;

        /* Check job count and user count if user is extending */
        if (request.payload.isExtend) {
            subscriptionToSave.numberOfJobs.count = existingSubscription.numberOfJobs.count;
            subscriptionToSave.numberOfUsers.count = existingSubscription.numberOfUsers.count;
        }


        try {
            await subscriptionToSave.save();
        } catch (e) {
            logger.error('Error occurred saving subscription information in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Send email to the app support for the created subscription */
        if (process.env.NODE_ENV === 'production') {
            let companyType, constant;

            try {
                constant = await constantSchema.constantSchema.findOne({}, {businessTypes: 1}, {lean: true});
            } catch (e) {
                logger.error('Error in finding constant data while creating subscription %s:', JSON.stringify(e));
            }

            if (constant.businessTypes) {
                const idx = constant.businessTypes.findIndex(k => k._id.toString() === checkUser.employerInformation.companyType);
                if (idx !== -1) {
                    companyType = constant.businessTypes[idx].name;
                }
            }

            const mailOptions = {
                from: 'support@ezjobs.io',
                to: 'sales@ezjobs.io',
                subject: 'Payment screen visited',
                text: 'Email: ' + checkUser.email + '\n' +
                    'Name: ' + checkUser.firstName + ' ' + checkUser.lastName + '\n' +
                    'Phone: ' + checkUser.employerInformation.countryCode + (checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'N/A') + '\n' +
                    'Package: ' + checkPlan.packageName + '\n' +
                    'Price: ' + (request.payload.planType.toLowerCase() === 'monthly' ? checkPlan.totalMonthly : checkPlan.totalYearly) + '\n' +
                    'Company Name: ' + checkUser.employerInformation.companyName + '\n' +
                    'Company Type: ' + (companyType ? companyType : 'NA') + '\n' +
                    'Payment Type: ' + (request.payload.isOneTime ? 'One-time' : 'Recurring')
            };
            try {
                await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
            } catch (e) {
                logger.error('Error in sending email to support while creating subscription %s:', JSON.stringify(e));
            }

            let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(checkUser.email, [{property: 'plan_visited', value: checkPlan.packageName}, {property: 'plan_visited_date', value: new Date().setHours(0, 0, 0, 0)}]);
            if (statusEmployer === 404) {
                console.log('HubSpot contact not found');
            }

        }

        let source, contactSource, checkContact;

        if (process.env.NODE_ENV === 'production') {
            if (checkUser.facebookId.id) {
                source = 'Facebook';
            } else if (checkUser.googleId.id) {
                source = 'Google';
            } else if (checkUser.linkedInId.id) {
                source = 'Linkedin';
            } else if (checkUser.phone) {
                source = 'Phone';
            } else {
                source = 'Email';
            }
            if (checkUser.deviceType.toLowerCase() === 'android') {
                contactSource = 'Android App';
            } else if (checkUser.deviceType.toLowerCase() === 'ios') {
                contactSource = 'IOS App';
            } else {
                contactSource = 'Web';
            }

            /* Engage Bay */
            try {
                checkContact = await commonFunctions.Handlers.checkEngageBayContact(checkUser.email);
            } catch (e) {
                logger.error('Error occurred while checking contact existence %s:', e);
            }

            if (checkContact && checkContact.status !== 200) {
                let contactProperties = [], contactData = {
                    properties: [],
                    companyIds: []
                }, checkCompany;

                const firstName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.firstName);
                contactProperties.push(firstName.getProperties());

                const lastName = new commonFunctions.engageBay('last_name', 'TEXT', 'SYSTEM', true, checkUser.lastName);
                contactProperties.push(lastName.getProperties());

                const email = new commonFunctions.engageBay('email', 'TEXT', 'SYSTEM', true, checkUser.email);
                contactProperties.push(email.getProperties());

                const phone = new commonFunctions.engageBay('phone', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.countryCode + checkUser.employerInformation.companyPhone);
                contactProperties.push(phone.getProperties());

                const engageSource = new commonFunctions.engageBay('Source', 'TEXT', 'CUSTOM', true, source);
                contactProperties.push(engageSource.getProperties());

                const engageContactSource = new commonFunctions.engageBay('Contact source', 'TEXT', 'CUSTOM', true, contactSource);
                contactProperties.push(engageContactSource.getProperties());

                contactData.properties = contactProperties;

                if (checkUser.employerInformation.companyName) {
                    try {
                        checkCompany = await commonFunctions.Handlers.checkEngageBayCompany(checkUser.employerInformation.companyName);
                    } catch (e) {
                        logger.error('Error occurred while checking company existence %s:', e);
                    }

                    if (checkCompany === 'NOTFOUND') {
                        /* Create company in Engage Bay */
                        let company, companyProperties = [], companyData = {
                            properties: []
                        };

                        const engageCompanyName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.companyName);
                        companyProperties.push(engageCompanyName.getProperties());

                        companyData.properties = companyProperties;

                        try {
                            company = await commonFunctions.Handlers.createEngageBayCompany(companyData);
                        } catch (e) {
                            logger.error('Error occurred while creating company data %s:', e);
                        }

                        if (company.status === 200) {
                            contactData.companyIds.push(company.data.id);
                        }

                    } else if (checkCompany.id) {
                        contactData.companyIds.push(checkCompany.id);
                    }
                }

                try {
                    checkContact = await commonFunctions.Handlers.createEngageBayContact(contactData);
                } catch (e) {
                    logger.error('Error occurred while creating contact data %s:', e);
                }

            }
        }

        /* Update package info on hubspot */
        if (process.env.NODE_ENV === 'production') {
            let engageBayProperties = [];

            const planVisited = new commonFunctions.engageBay('Plan_visited', 'TEXT', 'CUSTOM', true, checkPlan.packageName);
            engageBayProperties.push(planVisited.getProperties());

            const planVisitedDate = new commonFunctions.engageBay('Plan_visited_date', 'DATE', 'CUSTOM', true, new Date().toLocaleDateString());
            engageBayProperties.push(planVisitedDate.getProperties());

            if (engageBayProperties.length) {
                try {
                    await commonFunctions.Handlers.updateEngageBayContact({id: checkContact.data.id, properties: engageBayProperties});
                } catch (e) {
                    logger.error('Error occurred while updating user in engage bay %s:', JSON.stringify(e));
                }
            }
        }


        if (request.payload.isOneTime) {
            return h.response(responseFormatter.responseFormatter({orderId: subscriptionToSave.orderId, subscriptionId: subscriptionToSave._id}, 'Order created', 'success', 201)).code(200);
        } else {
            return h.response(responseFormatter.responseFormatter({razorSubscriptionId: subscriptionToSave.razorSubscriptionId, subscriptionId: subscriptionToSave._id}, 'Subscription created', 'success', 201)).code(200);
        }
    };

    handler.createSubscriptionNew = async (request, h) => {
        let subscription, checkUser, decoded, checkPackage, activeJobs, existingSubscription, order, currency, constantData, taxBracket = {};

        /* Check if user exists in database */
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user information in create subscription new handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
        } else if (checkUser.isSlave) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to purchase subscription package. Please contact your account admin.', 'error', 400)).code(400);
        }

        /* Check whether access token is valid */
        try {
            decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
        } catch (e) {
            logger.error('Error occurred decoding token in create subscription new handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (decoded.userId !== checkUser._id.toString()) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
        }

        /* Check whether subscription exists already for the same user */
        try {
            existingSubscription = await subscriptionSchema.subscriptionSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userId), isFree: false, isActive: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding existing subscription in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!request.payload.isExtend) {
            if (existingSubscription && existingSubscription.isActive) {
                return h.response(responseFormatter.responseFormatter({}, 'You have already purchased a subscription.', 'error', 400)).code(400);
            }
        }

        /* Check whether plan exists */
        try {
            checkPackage = await packageSchema.packageSchema.findById({_id: request.payload.packageId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding package information in create subscription new handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkPackage) {
            return h.response(responseFormatter.responseFormatter({}, 'No such package found', 'error', 400)).code(400);
        }

        try {
            currency = await codeSchema.CodeSchema.findOne({countryISOName: checkPackage.country}, {currencyName: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting currency data in create pricing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get the constant data for getting tax numbers */
        try {
            constantData = await constantSchema.constantSchema.findOne({}, {taxes: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding constant data in create subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        const taxIndex = constantData.taxes.findIndex(k => k.country.toLowerCase() === checkPackage.country.toLowerCase());
        if (taxIndex !== -1) {
            taxBracket = constantData.taxes[taxIndex];
        } else {
            taxBracket = {
                taxType: 'NA',
                taxAmount: 0
            }
        }

        let startAt, expiresAt;
        expiresAt = new Date(moment.tz("America/New_York").add(checkPackage.validity > 0 ? checkPackage.validity : 40000, 'days'));

        const notes = {
            customerId: checkUser._id,
            customerName: checkUser.firstName + ' ' + checkUser.lastName,
            email: checkUser.email,
            phone: checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'NA'
        };

        let amount;
        amount = (checkPackage.total * (1 + (taxBracket.taxAmount / 100))).toFixed(2) * 100;

        order = await rzrPay.Handler.createOrder(amount, currency.currencyName, notes);
        if (order.statusCode && order.statusCode !== 200) {
            return h.response(responseFormatter.responseFormatter({}, order.error.error.description, 'error', order.statusCode)).code(order.statusCode);
        }

        /* Get posted jobs */
        try {
            activeJobs = await jobSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(request.payload.userId), isArchived: false, isTranslated: false, isVisible: true});
        } catch (e) {
            logger.error('Error occurred finding active jobs count information in create subscription new handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Save subscription in database */
        const packageId = checkPackage._id;
        delete checkPackage._id;

        let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPackage);
        delete subscriptionToSave.createdAt;
        delete subscriptionToSave.updatedAt;
        subscriptionToSave.isActive = false;
        subscriptionToSave.userId = request.payload.userId;
        subscriptionToSave.packageId = packageId;
        subscriptionToSave.expiresAt = expiresAt ? expiresAt : undefined;
        subscriptionToSave.orderId = order ? order.id : '';
        subscriptionToSave.taxAmount = taxBracket ? taxBracket.taxAmount : 0;
        subscriptionToSave.taxType = taxBracket ? taxBracket.taxType : '';
        subscriptionToSave.totalAmountPaid = amount / 100;
        subscriptionToSave.isExtend = !!request.payload.isExtend;
        subscriptionToSave.numberOfJobs.count = checkPackage.numberOfJobs.count - activeJobs;

        /* Check job count and user count if user is extending */
        if (request.payload.isExtend) {
            subscriptionToSave.numberOfJobs.count = existingSubscription.numberOfJobs.count;
            subscriptionToSave.numberOfUsers.count = existingSubscription.numberOfUsers.count;
        }

        try {
            await subscriptionToSave.save();
        } catch (e) {
            logger.error('Error occurred saving subscription information in create subscription new handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Send email to the app support for the created subscription */
        if (process.env.NODE_ENV === 'production') {
            let companyType, constant;

            try {
                constant = await constantSchema.constantSchema.findOne({}, {businessTypes: 1}, {lean: true});
            } catch (e) {
                logger.error('Error in finding constant data while creating new subscription %s:', JSON.stringify(e));
            }

            if (constant.businessTypes) {
                const idx = constant.businessTypes.findIndex(k => k._id.toString() === checkUser.employerInformation.companyType);
                if (idx !== -1) {
                    companyType = constant.businessTypes[idx].name;
                }
            }

            const mailOptions = {
                from: 'support@ezjobs.io',
                to: 'sales@ezjobs.io',
                subject: 'Payment screen visited',
                text: 'Email: ' + checkUser.email + '\n' +
                    'Name: ' + checkUser.firstName + ' ' + checkUser.lastName + '\n' +
                    'Phone: ' + checkUser.employerInformation.countryCode + (checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'N/A') + '\n' +
                    'Package: ' + checkPackage.packageName + '\n' +
                    'Price: ' + checkPackage.total + '\n' +
                    'Company Name: ' + checkUser.employerInformation.companyName + '\n' +
                    'Company Type: ' + (companyType ? companyType : 'NA') + '\n' +
                    'Payment Type: ' + (request.payload.isOneTime ? 'One-time' : 'Recurring')
            };
            try {
                await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
            } catch (e) {
                logger.error('Error in sending email to support while creating new subscription %s:', JSON.stringify(e));
            }

            let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(checkUser.email, [{property: 'plan_visited', value: checkPlan.packageName}, {property: 'plan_visited_date', value: new Date().setHours(0, 0, 0, 0)}]);
            if (statusEmployer === 404) {
                console.log('HubSpot contact not found');
            }

        }

        let source, contactSource, checkContact;

        if (process.env.NODE_ENV === 'production') {
            if (checkUser.facebookId.id) {
                source = 'Facebook';
            } else if (checkUser.googleId.id) {
                source = 'Google';
            } else if (checkUser.linkedInId.id) {
                source = 'Linkedin';
            } else if (checkUser.phone) {
                source = 'Phone';
            } else {
                source = 'Email';
            }
            if (checkUser.deviceType.toLowerCase() === 'android') {
                contactSource = 'Android App';
            } else if (checkUser.deviceType.toLowerCase() === 'ios') {
                contactSource = 'IOS App';
            } else {
                contactSource = 'Web';
            }

            /* Engage Bay */
            try {
                checkContact = await commonFunctions.Handlers.checkEngageBayContact(checkUser.email);
            } catch (e) {
                logger.error('Error occurred while checking contact existence %s:', e);
            }

            if (checkContact && checkContact.status !== 200) {
                let contactProperties = [], contactData = {
                    properties: [],
                    companyIds: []
                }, checkCompany;

                const firstName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.firstName);
                contactProperties.push(firstName.getProperties());

                const lastName = new commonFunctions.engageBay('last_name', 'TEXT', 'SYSTEM', true, checkUser.lastName);
                contactProperties.push(lastName.getProperties());

                const email = new commonFunctions.engageBay('email', 'TEXT', 'SYSTEM', true, checkUser.email);
                contactProperties.push(email.getProperties());

                const phone = new commonFunctions.engageBay('phone', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.countryCode + checkUser.employerInformation.companyPhone);
                contactProperties.push(phone.getProperties());

                const engageSource = new commonFunctions.engageBay('Source', 'TEXT', 'CUSTOM', true, source);
                contactProperties.push(engageSource.getProperties());

                const engageContactSource = new commonFunctions.engageBay('Contact source', 'TEXT', 'CUSTOM', true, contactSource);
                contactProperties.push(engageContactSource.getProperties());

                contactData.properties = contactProperties;

                if (checkUser.employerInformation.companyName) {
                    try {
                        checkCompany = await commonFunctions.Handlers.checkEngageBayCompany(checkUser.employerInformation.companyName);
                    } catch (e) {
                        logger.error('Error occurred while checking company existence %s:', e);
                    }

                    if (checkCompany === 'NOTFOUND') {
                        /* Create company in Engage Bay */
                        let company, companyProperties = [], companyData = {
                            properties: []
                        };

                        const engageCompanyName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.companyName);
                        companyProperties.push(engageCompanyName.getProperties());

                        companyData.properties = companyProperties;

                        try {
                            company = await commonFunctions.Handlers.createEngageBayCompany(companyData);
                        } catch (e) {
                            logger.error('Error occurred while creating company data %s:', e);
                        }

                        if (company.status === 200) {
                            contactData.companyIds.push(company.data.id);
                        }

                    } else if (checkCompany.id) {
                        contactData.companyIds.push(checkCompany.id);
                    }
                }

                try {
                    checkContact = await commonFunctions.Handlers.createEngageBayContact(contactData);
                } catch (e) {
                    logger.error('Error occurred while creating contact data %s:', e);
                }

            }
        }

        /* Update package info on hubspot */
        if (process.env.NODE_ENV === 'production') {
            let engageBayProperties = [];

            const planVisited = new commonFunctions.engageBay('Plan_visited', 'TEXT', 'CUSTOM', true, checkPackage.packageName);
            engageBayProperties.push(planVisited.getProperties());

            const planVisitedDate = new commonFunctions.engageBay('Plan_visited_date', 'DATE', 'CUSTOM', true, new Date().toLocaleDateString());
            engageBayProperties.push(planVisitedDate.getProperties());

            if (engageBayProperties.length) {
                try {
                    await commonFunctions.Handlers.updateEngageBayContact({id: checkContact.data.id, properties: engageBayProperties});
                } catch (e) {
                    logger.error('Error occurred while updating user in engage bay %s:', JSON.stringify(e));
                }
            }
        }


        return h.response(responseFormatter.responseFormatter({orderId: subscriptionToSave.orderId, subscriptionId: subscriptionToSave._id}, 'Order created', 'success', 201)).code(200);
    };

    handler.validateSignature = async (request, h) => {
        let checkUser, decoded, checkSubscription, isSignatureValid, checkPackage, plan, activeJobs, oldSubscription;

        /* Check if user exists in database */
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user information in validate signature handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
        }

        /* Check whether access token is valid */
        try {
            decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
        } catch (e) {
            logger.error('Error occurred decoding token in validate signature handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (decoded.userId !== checkUser._id.toString()) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
        }

        /* Check whether subscription exists */
        try {
            checkSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: request.payload.subscriptionId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding subscription in validate signature handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkSubscription) {
            return h.response(responseFormatter.responseFormatter({}, 'Subscription not found', 'error', 404)).code(400);
        }

        /* If extension is there then check the old subscription for the expiration date */
        if (checkSubscription.isExtend) {
            try {
                oldSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding old subscription in validate signature handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!oldSubscription || oldSubscription.isFree || !oldSubscription.isActive || !oldSubscription.orderId) {
                return h.response(responseFormatter.responseFormatter({}, 'No active subscription to renew. Please contact support at support@ezjobs.io.', 'error', 400)).code(400);
            }
        }

        /* Verify signature */
        if (request.payload.orderId) {
            isSignatureValid = rzrPay.Handler.validateSignature(request.payload.razorpay_payment_id, request.payload.orderId, request.payload.razorpay_signature, true);
        } else if (checkSubscription.orderId) {
            isSignatureValid = rzrPay.Handler.validateSignature(request.payload.razorpay_payment_id, checkSubscription.orderId, request.payload.razorpay_signature, true);
        } else {
            isSignatureValid = rzrPay.Handler.validateSignature(request.payload.razorpay_payment_id, checkSubscription.razorSubscriptionId, request.payload.razorpay_signature, false);
        }

        if (isSignatureValid) {
            /* If one time is there then add the expiry as well */
            let dataToUpdate, expiresAt, expiresAtFromToday;
            if (checkSubscription.orderId) {

                if (request.payload.isRecharge) {
                    /* Find the recharge amount and add it to the walletAmount */
                    const idx = checkSubscription.addOns.findIndex(k => k.orderId === request.payload.orderId);
                    if (idx !== -1) {
                        checkSubscription.addOns[idx].isPaid = true;
                        dataToUpdate = {
                            $inc: {
                                walletAmount: checkSubscription.addOns[idx].rechargeAmount
                            },
                            $set: {
                                addOns: checkSubscription.addOns
                            }
                        }
                    } else {
                        return h.response(responseFormatter.responseFormatter({}, 'No such order found. Please contact us immediately.', 'error', 400)).code(400);
                    }
                } else if (request.payload.isAddOn) {
                    dataToUpdate = {
                        $inc: {},
                        $set: {}
                    }
                    /* Loop through all the add on features and increase the count accordingly */
                    const idx = checkSubscription.addOns.findIndex(k => k.orderId === request.payload.orderId);
                    if (idx !== -1) {
                        for (let i = 0; i < checkSubscription.addOns[idx].features.length; i++) {
                            dataToUpdate.$inc[checkSubscription.addOns[idx].features[i].key + '.count'] = checkSubscription.addOns[idx].features[i].count;
                        }
                        checkSubscription.addOns[idx].isPaid = true;
                        try {
                            await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkSubscription._id}, {$set: {addOns: checkSubscription.addOns}});
                        } catch (e) {
                            logger.error('Error occurred in updating subscription in validate signature handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }

                    } else {
                        return h.response(responseFormatter.responseFormatter({}, 'No such order found. Please contact us immediately.', 'error', 400)).code(400);
                    }
                } else {
                    if (checkSubscription.isExtend) {
                        if (checkSubscription.planType.toLowerCase() === 'monthly') {
                            expiresAt = new Date(moment(oldSubscription.expiresAt).add(1, 'months'));
                            expiresAtFromToday = new Date(moment.tz("America/New_York").add(1, 'months'));
                        } else if (checkSubscription.planType.toLowerCase() === 'monthly') {
                            expiresAt = new Date(moment(oldSubscription.expiresAt).add(1, 'years'));
                            expiresAtFromToday = new Date(moment.tz("America/New_York").add(1, 'years'));
                        } else {
                            expiresAt = new Date(moment(oldSubscription.expiresAt).add(checkSubscription.validity, 'days'));
                            expiresAtFromToday = new Date(moment.tz("America/New_York").add(checkSubscription.validity, 'days'));
                        }
                    } else {
                        if (checkSubscription.planType.toLowerCase() === 'monthly') {
                            expiresAtFromToday = new Date(moment.tz("America/New_York").add(1, 'months'));
                        } else if (checkSubscription.planType.toLowerCase() === 'yearly') {
                            expiresAtFromToday = new Date(moment.tz("America/New_York").add(1, 'years'));
                        } else {
                            expiresAtFromToday = new Date(moment.tz("America/New_York").add(checkSubscription.validity, 'days'));
                        }
                    }

                    dataToUpdate = {
                        $set: {
                            isSignatureVerified: true,
                            isPaid: true,
                            razorpay_payment_id: request.payload.razorpay_payment_id,
                            isActive: true,
                            isEnded: false,
                            startDate: new Date(),
                            expiresAt: checkSubscription.isExtend ? expiresAt : expiresAtFromToday
                        }
                    };
                }
            } else {
                dataToUpdate = {
                    $set: {
                        isSignatureVerified: true,
                        isPaid: true,
                        razorpay_payment_id: request.payload.razorpay_payment_id,
                        isActive: true,
                        isEnded: false,
                        startDate: new Date()
                    }
                };
            }

            /* Check if plan exists (In case of custom pricing package) */
            if (!checkSubscription.planId && checkSubscription.isCustom) {
                let customPackage;

                try {
                    customPackage = await packageSchema.packageSchema.findOne({country: checkUser.employerInformation.country, isActive: true, isCustom: true}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding custom package in validate signature handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (!customPackage) {
                    return h.response(responseFormatter.responseFormatter({}, 'No custom package found.', 'error', 404)).code(404);
                }

                /* Get posted jobs */
                try {
                    activeJobs = await jobSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(request.payload.userId), isArchived: false, isTranslated: false});
                } catch (e) {
                    logger.error('Error occurred finding active jobs count information in validate signature handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                const packageToSave = {
                    country: checkUser.employerInformation.country,
                    packageName: 'Custom',
                    numberOfJobs: {
                        isIncluded: checkSubscription.numberOfJobs.isIncluded,
                        heading: customPackage.numberOfJobs.heading,
                        label: customPackage.numberOfJobs.label,
                        isFree: checkSubscription.numberOfJobs.isFree,
                        isUnlimited: checkSubscription.numberOfJobs.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        count: checkSubscription.numberOfJobs.count + activeJobs,
                        monthlyCount: checkSubscription.planType === 'monthly' ? checkSubscription.numberOfJobs.count + activeJobs : 0,
                        yearlyCount: checkSubscription.planType === 'yearly' ? checkSubscription.numberOfJobs.count + activeJobs : 0,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.numberOfJobs.type,
                        multiple: customPackage.numberOfJobs.multiple
                    },
                    numberOfUsers: {
                        isIncluded: checkSubscription.numberOfUsers.isIncluded,
                        heading: customPackage.numberOfUsers.heading,
                        label: customPackage.numberOfUsers.label,
                        isFree: checkSubscription.numberOfUsers.isFree,
                        isUnlimited: checkSubscription.numberOfUsers.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        count: checkSubscription.numberOfUsers.count,
                        monthlyCount: checkSubscription.planType === 'monthly' ? checkSubscription.numberOfUsers.count : 0,
                        yearlyCount: checkSubscription.planType === 'yearly' ? checkSubscription.numberOfUsers.count : 0,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.numberOfUsers.type,
                        multiple: customPackage.numberOfUsers.multiple
                    },
                    numberOfViews: {
                        isIncluded: checkSubscription.numberOfViews.isIncluded,
                        heading: customPackage.numberOfViews.heading,
                        label: customPackage.numberOfViews.label,
                        isFree: checkSubscription.numberOfViews.isFree,
                        isUnlimited: checkSubscription.numberOfViews.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        count: checkSubscription.numberOfViews.count,
                        monthlyCount: checkSubscription.planType === 'monthly' ? checkSubscription.numberOfViews.count : 0,
                        yearlyCount: checkSubscription.planType === 'yearly' ? checkSubscription.numberOfViews.count : 0,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.numberOfViews.type,
                        multiple: customPackage.numberOfViews.multiple
                    },
                    videoCall: {
                        isIncluded: checkSubscription.videoCall.isIncluded,
                        heading: customPackage.videoCall.heading,
                        label: customPackage.videoCall.label,
                        isFree: checkSubscription.videoCall.isFree,
                        isUnlimited: checkSubscription.videoCall.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.videoCall.type,
                        multiple: customPackage.videoCall.multiple
                    },
                    audioCall: {
                        isIncluded: checkSubscription.audioCall.isIncluded,
                        heading: customPackage.audioCall.heading,
                        label: customPackage.audioCall.label,
                        isFree: checkSubscription.audioCall.isFree,
                        isUnlimited: checkSubscription.audioCall.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.audioCall.type,
                        multiple: customPackage.audioCall.multiple
                    },
                    numberOfTextTranslations: {
                        isIncluded: checkSubscription.numberOfTextTranslations.isIncluded,
                        heading: customPackage.numberOfTextTranslations.heading,
                        label: customPackage.numberOfTextTranslations.label,
                        isFree: checkSubscription.numberOfTextTranslations.isFree,
                        isUnlimited: checkSubscription.numberOfTextTranslations.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        count: checkSubscription.numberOfTextTranslations.count,
                        monthlyCount: checkSubscription.planType === 'monthly' ? checkSubscription.numberOfTextTranslations.count : 0,
                        yearlyCount: checkSubscription.planType === 'yearly' ? checkSubscription.numberOfTextTranslations.count : 0,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.numberOfTextTranslations.type,
                        multiple: customPackage.numberOfTextTranslations.multiple
                    },
                    numberOfJobTranslations: {
                        isIncluded: checkSubscription.numberOfJobTranslations.isIncluded,
                        heading: customPackage.numberOfJobTranslations.heading,
                        label: customPackage.numberOfJobTranslations.label,
                        isFree: checkSubscription.numberOfJobTranslations.isFree,
                        isUnlimited: checkSubscription.numberOfJobTranslations.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        count: checkSubscription.numberOfJobTranslations.count,
                        monthlyCount: checkSubscription.planType === 'monthly' ? checkSubscription.numberOfJobTranslations.count : 0,
                        yearlyCount: checkSubscription.planType === 'yearly' ? checkSubscription.numberOfJobTranslations.count : 0,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.numberOfJobTranslations.type,
                        multiple: customPackage.numberOfJobTranslations.multiple
                    },
                    showOnline: {
                        isIncluded: checkSubscription.showOnline.isIncluded,
                        heading: customPackage.showOnline.heading,
                        label: customPackage.showOnline.label,
                        isFree: checkSubscription.showOnline.isFree,
                        isUnlimited: checkSubscription.showOnline.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.showOnline.type,
                        multiple: customPackage.showOnline.multiple
                    },
                    jobsInAllLocalities: {
                        isIncluded: checkSubscription.jobsInAllLocalities.isIncluded,
                        heading: customPackage.jobsInAllLocalities.heading,
                        label: customPackage.jobsInAllLocalities.label,
                        isFree: checkSubscription.jobsInAllLocalities.isFree,
                        isUnlimited: checkSubscription.jobsInAllLocalities.isUnlimited,
                        isForcedMonthly: false,
                        isForcedYearly: false,
                        forcedMonthly: 0,
                        forcedYearly: 0,
                        totalMonthly: 0,
                        totalYearly: 0,
                        type: customPackage.jobsInAllLocalities.type,
                        multiple: customPackage.jobsInAllLocalities.multiple
                    },
                    yearlyDiscount: 0,
                    monthlyDiscount: 0,
                    packageDiscount: 0,
                    totalMonthly: 0,
                    totalYearly: 0,
                    totalMonthlyBeforeTax: 0,
                    totalYearlyBeforeTax: 0,
                    taxType: '',
                    total: 0,
                    taxAmount: 0,
                    totalMonthlyOriginal: 0,
                    totalYearlyOriginal: 0,
                    yearlyDiscountAmount: 0,
                    monthlyDiscountAmount: 0,
                    packageDiscountMonthlyAmount: 0,
                    packageDiscountYearlyAmount: 0,
                    planIdMonthly: '',
                    planIdAnnually: '',
                    numberOfUsersEnrolled: 0,
                    rank: 0,
                    isActive: false,
                    isFree: false,
                    idx: customPackage.idx,
                    isCustom: true,
                    trialPeriod: 0,
                    isVisible: false,
                    isCustom: true
                };
                try {
                    plan = await new packageSchema.packageSchema(packageToSave).save();
                } catch (e) {
                    logger.error('Error occurred in saving custom package in validate signature handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                dataToUpdate.$set.packageId = plan._id;
            }

            if (checkSubscription.isExtend) {
                const dataToSave = {
                    userId: mongoose.Types.ObjectId(request.payload.userId),
                    subscriptionId: mongoose.Types.ObjectId(request.payload.subscriptionId),
                    renewalDate: oldSubscription.expiresAt,
                    currentSubscriptionId: oldSubscription._id
                };

                /* Save data in collection */
                try {
                    await new subscriptionRenewalSchema.subscriptionRenewalSchema(dataToSave).save();
                } catch (e) {
                    logger.error('Error occurred in saving renewal subscription data in validate signature handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                try {
                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: request.payload.subscriptionId}, dataToUpdate, {
                        lean: true,
                        new: true
                    });
                } catch (e) {
                    logger.error('Error occurred in updating subscription in validate signature handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

            } else {
                try {
                    checkSubscription = await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: request.payload.subscriptionId}, dataToUpdate, {
                        lean: true,
                        new: true
                    });
                } catch (e) {
                    logger.error('Error occurred in updating subscription in validate signature handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (request.payload.isAddOn || request.payload.isRecharge) {
                    /* Do nothing */
                } else {
                    /* Update user information */
                    try {
                        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {
                            $set: {
                                'subscriptionInfo.subscriptionId': mongoose.Types.ObjectId(request.payload.subscriptionId),
                                'subscriptionInfo.packageId': mongoose.Types.ObjectId(checkSubscription.packageId),
                                trialPeriodUsed: true
                            }
                        }, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in updating user data in validate signature handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    /* Update slave users also if any */
                    let employerData;
                    try {
                        employerData = await userSchema.UserSchema.findById({_id: request.payload.userId}, {slaveUsers: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in finding master user data in validate signature handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    if (employerData) {
                        if (employerData.slaveUsers.length) {
                            try {
                                await userSchema.UserSchema.updateMany({_id: {$in: employerData.slaveUsers}}, {
                                    $set: {
                                        'subscriptionInfo.subscriptionId': mongoose.Types.ObjectId(request.payload.subscriptionId),
                                        'subscriptionInfo.packageId': mongoose.Types.ObjectId(checkSubscription.packageId),
                                        trialPeriodUsed: true
                                    }
                                });
                            } catch (e) {
                                logger.error('Error occurred in updating user data in validate signature handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        }
                    }

                    /* Increase the count of enrolled users for the package */
                    try {
                        checkPackage = await packageSchema.packageSchema.findByIdAndUpdate({_id: checkSubscription.packageId}, {$inc: {numberOfUsersEnrolled: 1}}, {
                            lean: true,
                            new: true
                        });
                    } catch (e) {
                        logger.error('Error occurred updating package information in create subscription handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    /* Send email to the user */
                    if (process.env.NODE_ENV === 'production') {
                        let mailOptions;
                        if (checkPackage.isCustom) {
                            mailOptions = {
                                from: 'support@ezjobs.io',
                                to: 'sales@ezjobs.io',
                                subject: 'Purchased',
                                text: 'Email: ' + checkUser.email + '\n' +
                                    'Name: ' + checkUser.firstName + ' ' + checkUser.lastName + '\n' +
                                    'Phone: ' + checkUser.employerInformation.countryCode + (checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'N/A') + '\n' +
                                    'Package: ' + checkPackage.packageName + '\n' +
                                    'Company Name: ' + checkUser.employerInformation.companyName + '\n' +
                                    'Payment Type: ' + (checkSubscription.orderId ? 'One-time' : 'Recurring')
                            };
                        } else {
                            mailOptions = {
                                from: 'support@ezjobs.io',
                                to: 'sales@ezjobs.io',
                                subject: 'Purchased',
                                text: 'Email: ' + checkUser.email + '\n' +
                                    'Name: ' + checkUser.firstName + ' ' + checkUser.lastName + '\n' +
                                    'Phone: ' + checkUser.employerInformation.countryCode + (checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'N/A') + '\n' +
                                    'Package: ' + checkPackage.packageName + '\n' +
                                    'Price: ' + (checkSubscription.planType.toLowerCase() === 'monthly' ? checkPackage.totalMonthly : checkPackage.totalYearly) + '\n' +
                                    'Company Name: ' + checkUser.employerInformation.companyName + '\n' +
                                    'Payment Type: ' + (checkSubscription.orderId ? 'One-time' : 'Recurring')
                            };
                        }

                        try {
                            await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
                        } catch (e) {
                            logger.error('Error in sending email to support while creating subscription %s:', JSON.stringify(e));
                        }
                    }


                    /* Send email about the same to customers */
                    if (dataToUpdate.$set.expiresAt) {
                        let purchaseDate, expiryForOneTime;
                        try {
                            expiryForOneTime = new Date(dataToUpdate.$set.expiresAt).toLocaleDateString('en', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            });
                            purchaseDate = new Date(checkSubscription.purchasedDate).toLocaleDateString('en', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            });
                        } catch (e) {
                            logger.error('Error in date conversion while creating subscription %s:', JSON.stringify(e));
                        }

                        let email = {
                            to: [{
                                email: checkUser.email,
                                type: 'to'
                            }],
                            subject: checkUser.firstName + ', Your EZJobs subscription initiated.',
                            important: true,
                            merge: true,
                            inline_css: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: checkUser.email,
                                vars: [
                                    {
                                        name: 'name',
                                        content: checkUser.firstName
                                    },
                                    {
                                        name: 'planname',
                                        content: checkPackage.packageName
                                    },
                                    {
                                        name: 'plantype',
                                        content: checkSubscription.planType
                                    },
                                    {
                                        name: 'subscriptionstartdate',
                                        content: purchaseDate
                                    },
                                    {
                                        name: 'amount',
                                        content: checkSubscription.totalAmountPaid
                                    },
                                    {
                                        name: 'subscriptionduedate',
                                        content: expiryForOneTime
                                    }
                                ]
                            }]
                        };
                        await mandrill.Handlers.sendTemplate('ezjobs-subscription', [], email, true);
                    }
                }
            }

            return h.response(responseFormatter.responseFormatter({}, 'Signature verified', 'success', 200)).code(200);
        }

        return h.response(responseFormatter.responseFormatter({}, 'Signature not valid', 'error', 404)).code(400);
    };

    handler.handleWebHook = async (request, h) => {
        let checkPlan, checkSubscription, dataToUpdate, subscriptionData;
        if (request.payload.event === 'subscription.charged') {
            if (request.payload.payload.payment && request.payload.payload.payment.entity.status === 'captured') {
                /* Check whether subscription exists already for the same user */
                try {
                    checkSubscription = await subscriptionSchema.subscriptionSchema.findOne({razorSubscriptionId: request.payload.payload.subscription.entity.id}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding existing subscription in handle webhook handler %s:', JSON.stringify(e));
                }

                /* Fetch plan details to reset all the counts */
                try {
                    checkPlan = await packageSchema.packageSchema.findOne({$or: [{planIdMonthly: checkSubscription.planId}, {planIdAnnually: checkSubscription.planId}]},
                        {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred finding package information in create subscription handler %s:', JSON.stringify(e));
                }

                if (checkSubscription && (checkSubscription.razorpay_payment_id !== request.payload.payload.payment.entity.id)) {
                    dataToUpdate = {
                        'numberOfViews.count': request.payload.planType === 'yearly' ? checkPlan.numberOfViews.yearlyCount : checkPlan.numberOfViews.monthlyCount,
                        'numberOfTextTranslations.count': request.payload.planType === 'yearly' ? checkPlan.numberOfTextTranslations.yearlyCount : checkPlan.numberOfTextTranslations.monthlyCount,
                        'numberOfJobTranslations.count': request.payload.planType === 'yearly' ? checkPlan.numberOfJobTranslations.yearlyCount : checkPlan.numberOfJobTranslations.monthlyCount,
                        isActive: true,
                        isPaid: true,
                        isEnded: false,
                        isSignatureVerified: true,
                        razorpay_payment_id: request.payload.payload.payment.entity.id,
                        startDate: new Date(),
                        customerId: request.payload.payload.subscription.entity.customer_id,
                        expiresAt: checkSubscription.planType.toLowerCase() === 'monthly' ? new Date(moment.tz("America/New_York").add(1, 'months')) : new Date(moment.tz("America/New_York").add(1, 'years')),
                        paymentMethod: request.payload.payload.payment.entity.method,
                        cardId: request.payload.payload.payment.entity.card_id ? request.payload.payload.payment.entity.card_id : {},
                        bank: request.payload.payload.payment.entity.bank ? request.payload.payload.payment.entity.bank : '',
                        wallet: request.payload.payload.payment.entity.wallet ? request.payload.payload.payment.entity.wallet : ''
                    };

                    /* Push existing subscription info in history array */
                    try {
                        subscriptionData = await subscriptionSchema.subscriptionSchema.findOneAndUpdate({razorSubscriptionId: request.payload.payload.subscription.entity.id}, {$set: dataToUpdate, $push: {history: checkSubscription}}, {lean: true, new: true});
                    } catch (e) {
                        logger.error('Error occurred updating subscription information in create subscription handler %s:', JSON.stringify(e));
                    }

                    /* Get user data */
                    let userData;

                    try {
                        userData = await userSchema.UserSchema.findById({_id: subscriptionData.userId}, {firstName: 1, lastName: 1, email: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in finding user information in razorpay webhook handler %s:', JSON.stringify(e));
                    }

                    let charge_at, chargeDate, purchaseDate;
                    try {
                        charge_at = new Date(request.payload.payload.subscription.entity.charge_at * 1000);
                        purchaseDate = new Date().toLocaleDateString('en', {year: 'numeric', month: 'long', day: 'numeric'});
                        chargeDate = charge_at.toLocaleDateString('en', {year: 'numeric', month: 'long', day: 'numeric'});
                    } catch (e) {
                        logger.error('Error in date conversion while creating subscription %s:', JSON.stringify(e));
                    }

                    /* Send email regarding the same */
                    let email = {
                        to: [{
                            email: userData.email,
                            type: 'to'
                        }],
                        subject: userData.firstName + ', Your EZJobs subscription has been renewed.',
                        important: true,
                        merge: true,
                        inline_css: true,
                        merge_language: 'mailchimp',
                        merge_vars: [{
                            rcpt: userData.email,
                            vars: [
                                {
                                    name: 'name',
                                    content: userData.firstName
                                },
                                {
                                    name: 'planname',
                                    content: checkPlan.packageName
                                },
                                {
                                    name: 'plantype',
                                    content: subscriptionData.planType
                                },
                                {
                                    name: 'subscriptionstartdate',
                                    content: purchaseDate
                                },
                                {
                                    name: 'amount',
                                    content: subscriptionData.totalAmountPaid
                                },
                                {
                                    name: 'subscriptionduedate',
                                    content: chargeDate
                                }
                            ]
                        }]
                    };
                    await mandrill.Handlers.sendTemplate('ezjobs-subscription', [], email, true);

                } else {
                    const update = {
                        paymentMethod: request.payload.payload.payment.entity.method,
                        cardId: request.payload.payload.payment.entity.card_id ? request.payload.payload.payment.entity.card_id : {},
                        bank: request.payload.payload.payment.entity.bank ? request.payload.payload.payment.entity.bank : '',
                        wallet: request.payload.payload.payment.entity.wallet ? request.payload.payload.payment.entity.wallet : '',
                        razorpay_payment_id: request.payload.payload.payment.entity.id,
                        isActive: true,
                        isEnded: false,
                        isSignatureVerified: true,
                        customerId: request.payload.payload.subscription.entity.customer_id
                    };

                    try {
                        subscriptionData = await subscriptionSchema.subscriptionSchema.findOneAndUpdate({razorSubscriptionId: request.payload.payload.subscription.entity.id}, {$set: update}, {lean: true, new: true});
                    } catch (e) {
                        logger.error('Error occurred updating subscription information in create subscription handler %s:', JSON.stringify(e));
                    }

                    /* Get user data */
                    let userData;

                    try {
                        userData = await userSchema.UserSchema.findById({_id: subscriptionData.userId}, {firstName: 1, lastName: 1, email: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in finding user information in razorpay webhook handler %s:', JSON.stringify(e));
                    }


                    /* Send email about the same to customers */
                    if (request.payload.payload.subscription.entity.charge_at) {
                        let charge_at, chargeDate, purchaseDate;
                        try {
                            charge_at = new Date(request.payload.payload.subscription.entity.charge_at * 1000);

                            purchaseDate = new Date(subscriptionData.purchasedDate).toLocaleDateString('en', {year: 'numeric', month: 'long', day: 'numeric'});
                            chargeDate = charge_at.toLocaleDateString('en', {year: 'numeric', month: 'long', day: 'numeric'});
                        } catch (e) {
                            logger.error('Error in date conversion while creating subscription %s:', JSON.stringify(e));
                        }

                        /* Create renewal record in database */


                        let email = {
                            to: [{
                                email: userData.email,
                                type: 'to'
                            }],
                            subject: userData.firstName + ', Your EZJobs subscription initiated.',
                            important: true,
                            merge: true,
                            inline_css: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: userData.email,
                                vars: [
                                    {
                                        name: 'name',
                                        content: userData.firstName
                                    },
                                    {
                                        name: 'planname',
                                        content: checkPlan.packageName
                                    },
                                    {
                                        name: 'plantype',
                                        content: subscriptionData.planType
                                    },
                                    {
                                        name: 'subscriptionstartdate',
                                        content: purchaseDate
                                    },
                                    {
                                        name: 'amount',
                                        content: subscriptionData.totalAmountPaid
                                    },
                                    {
                                        name: 'subscriptionduedate',
                                        content: chargeDate
                                    }
                                ]
                            }]
                        };
                        await mandrill.Handlers.sendTemplate('ezjobs-subscription', [], email, true);
                    }

                }
            }
        } else if (request.payload.event === 'subscription.pending' || request.payload.event === 'subscription.cancelled') {
            if (request.payload.payload.subscription) {
                try {
                    checkSubscription = await subscriptionSchema.subscriptionSchema.findOne({razorSubscriptionId: request.payload.payload.subscription.entity.id}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding existing subscription in handle webhook handler %s:', JSON.stringify(e));
                }
                if (checkSubscription) {
                    /* Stop the subscription */
                    try {
                        await subscriptionSchema.subscriptionSchema.findOneAndUpdate({razorSubscriptionId: request.payload.payload.subscription.entity.id}, {$set: {isActive: false, isEnded: true, isSignatureVerified: false}, $push: {errs: request.payload.payload.subscription.entity}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while updating existing subscription in handle webhook handler %s:', JSON.stringify(e));
                    }
                    /* Assign the user free package again */
                    let freePackage, checkPackage, numberOfJobsPosted = 0, subscriptionData, checkUser, updateCriteria = {}, adminData, users, activeJobs;

                    /* Get the country information of the user */
                    try {
                        checkUser = await userSchema.UserSchema.findById({_id: checkSubscription.userId}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while getting user data in handle webhook handler %s:', JSON.stringify(e));
                    }

                    try {
                        checkPackage = await packageSchema.packageSchema.findOne({country: checkUser.country, isFree: true, isActive: true}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred finding free package in handle webhook handler %s:', JSON.stringify(e));
                    }

                    try {
                        freePackage = await packageSchema.packageSchema.findOne({country: checkUser.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred finding free package in handle webhook handler %s:', JSON.stringify(e));
                    }

                    if (freePackage) {
                        updateCriteria.subscriptionInfo = {
                            packageId: freePackage._id
                        };

                        delete checkPackage._id;
                        /* Save subscription in database */
                        let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPackage);
                        delete subscriptionToSave.createdAt;
                        delete subscriptionToSave.updatedAt;
                        delete subscriptionToSave._id;
                        subscriptionToSave.isActive = false;
                        subscriptionToSave.userId = checkUser._id;
                        subscriptionToSave.planType = 'monthly';
                        subscriptionToSave.packageId = freePackage._id;
                        subscriptionToSave.numberOfJobs.count = checkPackage.numberOfJobs.monthlyCount;
                        subscriptionToSave.numberOfUsers.count = checkPackage.numberOfUsers.monthlyCount;
                        subscriptionToSave.numberOfViews.count = checkPackage.numberOfViews.monthlyCount;
                        subscriptionToSave.numberOfTextTranslations.count = checkPackage.numberOfTextTranslations.monthlyCount;
                        subscriptionToSave.numberOfJobTranslations.count = checkPackage.numberOfJobTranslations.monthlyCount;
                        subscriptionToSave.jobsInAllLocalities.count = checkPackage.jobsInAllLocalities.count;
                        subscriptionToSave.isEnded = false;
                        subscriptionToSave.isActive = true;
                        subscriptionToSave.isPaid = true;
                        subscriptionToSave.isFree = true;

                        try {
                            subscriptionData = await subscriptionToSave.save();
                        } catch (e) {
                            logger.error('Error occurred saving subscription information in handle webhook handler %s:', JSON.stringify(e));
                        }
                        updateCriteria.subscriptionInfo['subscriptionId'] = subscriptionData._id;

                        /* Assign new subscription to the user */
                        try {
                            await userSchema.UserSchema.findByIdAndUpdate({_id: checkSubscription.userId}, {$set: updateCriteria}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred updating user information in handle webhook handler %s:', JSON.stringify(e));
                        }

                        /* Archive all the posted jobs if any active jobs */
                        try {
                            activeJobs = await jobSchema.jobSchema.find({userId: mongoose.Types.ObjectId(checkSubscription.userId), isArchived: false, isVisible: true}, {}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred finding active jobs in handle webhook handler %s:', JSON.stringify(e));
                        }

                        /* Get admin data for adding admin ID */
                        try {
                            adminData = await adminSchema.AdminSchema.findOne({email: 'swapglobal@gmail.com'}, {_id: 1}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while finding admin in handle webhook handler %s:', JSON.stringify(e));
                        }

                        const len = activeJobs.length;
                        for (let i = 0; i < len; i++) {
                            let updatedJob;
                            /* Set job as archived */
                            try {
                                updatedJob = await jobSchema.jobSchema.findByIdAndUpdate({_id: activeJobs[i]._id}, {$set: {isArchived: true, isClosed: true, numberOfPositions: 0}}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while updating job in handle webhook handler %s:', JSON.stringify(e));
                            }

                            /* Update chats to mark job as archived */
                            let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
                            bulk
                                .find({jobId: mongoose.Types.ObjectId(activeJobs[i]._id), isHired: false})
                                .update({$set: {isArchived: true, isRejected: true, isHired: true}});
                            try {
                                await bulk.execute();
                            } catch (e) {
                                logger.error('Error occurred while updating chats data in handle webhook handler %s:', JSON.stringify(e));
                            }

                            /* Remove job from wish list as well */
                            try {
                                await favouriteSchema.favouriteSchema.deleteMany({jobId: mongoose.Types.ObjectId(activeJobs[i]._id)});
                            } catch (e) {
                                logger.error('Error occurred while deleting favourite data in handle webhook handler %s:', JSON.stringify(e));
                            }

                            /* Send push to all the users about the same */
                            let aggregationCriteria = [
                                {
                                    $match: {
                                        jobId: mongoose.Types.ObjectId(activeJobs[i]._id)
                                    }
                                },
                                {
                                    $lookup: {
                                        from: 'User',
                                        localField: 'candidateId',
                                        foreignField: '_id',
                                        as: 'user'
                                    }
                                },
                                {
                                    $unwind: '$user'
                                },
                                {
                                    $project: {
                                        deviceToken: '$user.deviceToken',
                                        deviceType: '$user.deviceType'
                                    }
                                }
                            ];

                            try {
                                users = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
                            } catch (e) {
                                logger.error('Error occurred while aggregating conversations for sending push to all candidates in handle webhook handler %s:', JSON.stringify(e));
                            }

                            const userLen = users.length;
                            let notifications = [], iosDevices = [], androidDevices = [];
                            for (let j = 0; j < userLen; j++) {
                                notifications.push({
                                    sentTo: mongoose.Types.ObjectId(users[j].userId),
                                    isAdmin: true,
                                    adminId: adminData._id,
                                    jobId: activeJobs[i]._id,
                                    isRead: false,
                                    message:  updatedJob.jobTitle + ' position has been closed by the employer. Keep applying to new jobs.',
                                    image: 'https://images.onata.com/test/02RNd9alezj.png',
                                    type: 'positionFilled'
                                });
                                if (users[i].deviceType.toLowerCase() === 'ios') {
                                    iosDevices.push(users[j].deviceToken);
                                } else {
                                    androidDevices.push(users[j].deviceToken);
                                }
                            }

                            /* Send push to both the users */
                            let title = 'Position filled', body = updatedJob.jobTitle + ' position has been closed by the employer. Keep applying to new jobs.', data = {pushType: 'positionFilled', jobId: activeJobs[i]._id};
                            push.createMessage('', androidDevices, data, 'ANDROID', title, body, 'beep');
                            push.createMessage('', iosDevices, data, 'IOS', title, body, 'beep');

                            /* Save into database */
                            try {
                                await notificationSchema.notificationSchema.insertMany(notifications);
                            } catch (e) {
                                logger.error('Error occurred while inserting notifications in handle webhook handler %s:', JSON.stringify(e));
                            }
                        }
                    }
                }
            }
        } else if (request.payload.event === 'order.paid') {
            if (request.payload.payload.order && request.payload.payload.payment) {
                try {
                    checkSubscription = await subscriptionSchema.subscriptionSchema.findOne({orderId: request.payload.payload.order.entity.id}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding existing subscription in handle webhook handler %s:', JSON.stringify(e));
                }

                if (checkSubscription) {
                    /* Update the payment method information into database */
                    const dataToUpdate = {
                        paymentMethod: request.payload.payload.payment.entity.method,
                        cardId: request.payload.payload.payment.entity.card_id ? request.payload.payload.payment.entity.card_id : {},
                        bank: request.payload.payload.payment.entity.bank ? request.payload.payload.payment.entity.bank : '',
                        wallet: request.payload.payload.payment.entity.wallet ? request.payload.payload.payment.entity.wallet : ''
                    };

                    try {
                        await subscriptionSchema.subscriptionSchema.findOneAndUpdate({orderId: request.payload.payload.order.entity.id}, {$set: dataToUpdate}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while updating existing subscription in handle webhook handler %s:', JSON.stringify(e));
                    }
                }
            }
        } else if (request.payload.event === 'payment.failed') {
            if (request.payload.payload.payment.entity && request.payload.payload.payment.entity.notes.customerId) {
                let checkUser, checkContact;
                try {
                    checkUser = await userSchema.UserSchema.findById({_id: request.payload.payload.payment.entity.notes.customerId}, {email: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding user in handle webhook handler %s:', JSON.stringify(e));
                }
                if (checkUser) {
                    /* Engage Bay */
                    try {
                        checkContact = await commonFunctions.Handlers.checkEngageBayContact(checkUser.email);
                    } catch (e) {
                        logger.error('Error occurred while checking contact existence %s:', e);
                    }
                    if (checkContact) {
                        let engageBayProperties = [];
                        const paymentMethod = new commonFunctions.engageBay('Payment_failed_method', 'TEXT', 'CUSTOM', true, request.payload.payload.payment.entity.method);
                        engageBayProperties.push(paymentMethod.getProperties());
                        const paymentReason = new commonFunctions.engageBay('Payment_failed_reason', 'TEXT', 'CUSTOM', true, request.payload.payload.payment.entity.error_description);
                        engageBayProperties.push(paymentReason.getProperties());
                        const paymentDate = new commonFunctions.engageBay('Payment_failed_on', 'DATE', 'CUSTOM', true, new Date(request.payload.payload.payment.entity.created_at * 1000).toLocaleDateString());
                        engageBayProperties.push(paymentDate.getProperties());
                        const email = new commonFunctions.engageBay('Razorpay_email', 'TEXT', 'CUSTOM', true, request.payload.payload.payment.entity.email);
                        engageBayProperties.push(email.getProperties());
                        const phone = new commonFunctions.engageBay('Razorpay_contact', 'PHONE', 'CUSTOM', true, request.payload.payload.payment.entity.contact);
                        engageBayProperties.push(phone.getProperties());
                        const amount = new commonFunctions.engageBay('Payment_failed_amount', 'NUMBER', 'CUSTOM', true, request.payload.payload.payment.entity.amount / 100);
                        engageBayProperties.push(amount.getProperties());
                        try {
                            await commonFunctions.Handlers.updateEngageBayContact({id: checkContact.data.id, properties: engageBayProperties});
                        } catch (e) {
                            logger.error('Error occurred while updating user in engage bay %s:', JSON.stringify(e));
                        }
                    }
                }
            }
        } else if (request.payload.event === 'payment.downtime.started' || request.payload.event === 'payment.downtime.resolved') {
            const status = request.payload.event === 'payment.downtime.started' ? 'down' : 'up';

            let email = {
                to: [{
                    email: 'csm@ezjobs.io',
                    type: 'to'
                }],
                subject: status === 'down' ? 'DOWNTIME: Razorpay is down' : 'RESTORED: Razorpay services are up',
                important: true,
                merge: true,
                inline_css: true,
                merge_language: 'mailchimp',
                merge_vars: [{
                    rcpt: 'csm@ezjobs.io',
                    vars: [
                        {
                            name: 'downtimeStatus',
                            content: 'Status: ' + status
                        },
                        {
                            name: 'method',
                            content: request.payload.payload['payment.downtime'].entity.method
                        },
                        {
                            name: 'begin',
                            content: new Date(request.payload.payload['payment.downtime'].entity.begin * 1000).toLocaleDateString()
                        },
                        {
                            name: 'end',
                            content: request.payload.payload['payment.downtime'].entity.end ? new Date(request.payload.payload['payment.downtime'].entity.end * 1000).toLocaleDateString() : '-'
                        },
                        {
                            name: 'status',
                            content: request.payload.payload['payment.downtime'].entity.status
                        },
                        {
                            name: 'scheduled',
                            content: request.payload.payload['payment.downtime'].entity.scheduled ? 'Yes' : 'No'
                        },
                        {
                            name: 'severity',
                            content: request.payload.payload['payment.downtime'].entity.severity
                        }
                    ]
                }]
            };
            await mandrill.Handlers.sendTemplate('razorpay-downtime', [], email, true);
        }

        return h.response().code(200);
    };

    handler.calculatePricing = async (request, h) => {
        let checkPackage, searchCriteria, constantData, checkPromo = {}, currency, dataToReturn = {
            planValue: 0,
            planDiscount: 0,
            monthlyDiscount: 0,
            yearlyDiscount: 0,
            promoDiscount: 0,
            subTotal: 0,
            tax: 0,
            total: 0
        };

        /* Find the package */
        if (request.query.planType.toLowerCase() === 'monthly') {
            searchCriteria = {
                planIdMonthly: request.query.planId
            };
        } else {
            searchCriteria = {
                planIdAnnually: request.query.planId
            };
        }

        try {
            checkPackage = await packageSchema.packageSchema.findOne(searchCriteria, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding package in calculate pricing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkPackage) {
            return h.response(responseFormatter.responseFormatter({}, 'Package not found.', 'error', 404)).code(404);
        }

        /* Check if promo is valid or not */
        if (request.query.promoCode && request.query.isOneTime) {
            try {
                checkPromo = await promoSchema.promoCodeSchema.findOne({promoCode: request.query.promoCode, planType: request.query.planType.toLowerCase()}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding promo data in calculate pricing handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!checkPromo) {
                return h.response(responseFormatter.responseFormatter({}, 'Invalid promo code.', 'error', 400)).code(400);
            } else if (checkPromo.planType.toLowerCase() !== request.query.planType.toLowerCase()) {
                return h.response(responseFormatter.responseFormatter({}, 'Invalid promo code.', 'error', 400)).code(400);
            }
            /*if (request.query.promoCode.toLowerCase() === 'ez500') {
                dataToReturn.promoDiscount = (request.query.planType.toLowerCase() === 'monthly') ? (checkPackage.totalMonthlyBeforeTax - 500) : (checkPackage.totalYearlyBeforeTax - 500);
            }*/
        } else {
            checkPromo.amount = 0;
        }

        if (request.query.isOneTime) {
            dataToReturn.planDiscount = (request.query.planType.toLowerCase() === 'monthly') ? (checkPackage.monthlyDiscountAmount + checkPackage.packageDiscountMonthlyAmount) : (checkPackage.yearlyDiscountAmount + checkPackage.packageDiscountYearlyAmount);
        } else {
            dataToReturn.planDiscount = (request.query.planType.toLowerCase() === 'monthly') ? (checkPackage.packageDiscountMonthlyAmount) : (checkPackage.packageDiscountYearlyAmount);
            dataToReturn.monthlyDiscount = checkPackage.monthlyDiscountAmount;
            dataToReturn.yearlyDiscount = checkPackage.yearlyDiscountAmount;
        }
        dataToReturn.promoDiscount = (request.query.planType.toLowerCase() === 'monthly') ?
            (checkPromo.promoType === 'fixed' ? (checkPromo.amount) : (checkPackage.totalMonthlyBeforeTax * checkPromo.amount / 100)) :
            (checkPromo.promoType === 'fixed' ? (checkPromo.amount) : (checkPackage.totalYearlyBeforeTax * checkPromo.amount / 100));
        dataToReturn.planValue = (request.query.planType.toLowerCase() === 'monthly') ? checkPackage.totalMonthlyOriginal : checkPackage.totalYearlyOriginal;
        dataToReturn.subTotal = request.query.isOneTime ? (dataToReturn.planValue - dataToReturn.planDiscount - dataToReturn.promoDiscount) :
            ((request.query.planType.toLowerCase() === 'monthly') ? ((dataToReturn.planValue - dataToReturn.planDiscount - dataToReturn.monthlyDiscount)) : (dataToReturn.planValue - dataToReturn.planDiscount - dataToReturn.yearlyDiscount));
        dataToReturn.tax = (dataToReturn.subTotal * (checkPackage.taxAmount / 100));
        dataToReturn.total = dataToReturn.subTotal + dataToReturn.tax;

        dataToReturn.planValue = parseFloat(dataToReturn.planValue.toFixed(2));
        dataToReturn.planDiscount = parseFloat(dataToReturn.planDiscount.toFixed(2));
        dataToReturn.promoDiscount = parseFloat(dataToReturn.promoDiscount.toFixed(2));
        dataToReturn.monthlyDiscount = parseFloat(dataToReturn.monthlyDiscount.toFixed(2));
        dataToReturn.yearlyDiscount = parseFloat(dataToReturn.yearlyDiscount.toFixed(2));
        dataToReturn.subTotal = parseFloat(dataToReturn.subTotal.toFixed(2));
        dataToReturn.tax = parseFloat(dataToReturn.tax.toFixed(2));
        dataToReturn.total = parseFloat(dataToReturn.total.toFixed(2));

        return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
    };

    handler.calculatePricingNew = async (request, h) => {
        let checkPackage, checkPromo = {}, dataToReturn = {
            planValue: 0,
            planDiscount: 0,
            promoDiscount: 0,
            subTotal: 0,
            tax: 0,
            total: 0,
            promotion: {},
            orderId: '',
            subscriptionId: ''
        }, checkUser, checkCurrentSubscription, decoded;

        try {
            [checkUser, decoded, checkPackage] = await Promise.all([
                userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true}),
                commonFunctions.Handlers.decodeToken(request.auth.credentials.token),
                packageSchema.packageSchema.findById({_id: request.query.packageId}, {}, {lean: true})
            ]);
        } catch (e) {
            logger.error('Error occurred while finding user information in new calculate pricing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
        } else if (checkUser.isSlave) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to purchase any packages. Please contact your admin account.', 'error', 400)).code(400);
        }

        if (decoded.userId !== checkUser._id.toString()) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
        }

        if (!checkPackage) {
            return h.response(responseFormatter.responseFormatter({}, 'Package not found.', 'error', 404)).code(404);
        }

        if (!request.query.subscriptionId) {
            /* Check if user has already bought any package */
            try {
                checkCurrentSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user subscription details in new calculate pricing handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!checkCurrentSubscription.isFree && checkCurrentSubscription.isActive) {
                return h.response(responseFormatter.responseFormatter({}, 'You already have purchased a package', 'error', 400)).code(400);
            }
        }

        if (request.query.isAddOn) {
            let subTotal = 0;
            for (let i = 0; i < request.query.features.length; i++) {
                subTotal += (request.query.features[i].count * request.query.features[i].basePrice) / (request.query.features[i].baseCount || 1);
            }
            dataToReturn.planValue = +subTotal.toFixed(2);
            dataToReturn.subTotal = +subTotal.toFixed(2);
        } else if (request.query.isWallet) {
            if (!request.query.rechargeAmount) {
                return h.response(responseFormatter.responseFormatter({}, 'Recharge amount must be greater than 0', 'error', 400)).code(400);
            } else {
                dataToReturn.planValue = +request.query.rechargeAmount.toFixed(2);
                dataToReturn.subTotal = +request.query.rechargeAmount.toFixed(2);
            }
        } else {
            dataToReturn.planValue = ((checkPackage.strikeTotal || checkPackage.total) * (request.query.quantity || 1));

            /* If promo code is provided then calculate it */
            if (request.query.promoId) {
                try {
                    checkPromo = await promoSchema.promoCodeSchema.findById({_id: request.query.promoId}, {
                        promotionName: 1,
                        promoCode: 1,
                        subText: 1,
                        expiration: 1,
                        packageIds: 1,
                        promoType: 1,
                        amount: 1
                    }, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding promotions in new calculate pricing handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!checkPromo.promoCode) {
                    return h.response(responseFormatter.responseFormatter({}, 'Invalid promo code', 'error', 404)).code(404);
                } else if (new Date(checkPromo.expiration) < new Date()) {
                    return h.response(responseFormatter.responseFormatter({}, 'This promotion is expired', 'error', 404)).code(404);
                }

                const idx = checkPromo.packageIds.findIndex(k => k.toString() === request.query.packageId);
                if (idx === -1) {
                    return h.response(responseFormatter.responseFormatter({}, 'This promotion is not valid for the current package', 'error', 400)).code(400);
                }
                dataToReturn.promotion = checkPromo;
            }

            dataToReturn.subTotal = commonFunctions.Handlers.calculateFinalPriceNew(checkPackage.total, (request.query.quantity || 1), checkPromo.promoType || 'fixed', checkPromo.amount || 0);

            if (checkPromo.promoCode) {
                if (checkPromo.promoType === 'fixed') {
                    dataToReturn.promoDiscount = +((checkPackage.total * (request.query.quantity || 1) - dataToReturn.subTotal)).toFixed(2);
                } else {
                    dataToReturn.promoDiscount = +((checkPackage.total * (request.query.quantity || 1) - dataToReturn.subTotal)).toFixed(2);
                }
                dataToReturn.planDiscount = +(dataToReturn.planValue - dataToReturn.subTotal - dataToReturn.promoDiscount).toFixed(2);
            } else {
                dataToReturn.planDiscount = +(dataToReturn.planValue - dataToReturn.subTotal).toFixed(2);
            }

            /* If quantity discount is applied */
            if (request.query.quantity && checkPackage.minQuantity && (request.query.quantity >= checkPackage.minQuantity)) {
                dataToReturn.subTotal = commonFunctions.Handlers.calculateFinalPriceNew(dataToReturn.subTotal, 1, 'percentage', checkPackage.quantityDiscount || 0);
                dataToReturn.planDiscount = +(dataToReturn.planValue - dataToReturn.promoDiscount - dataToReturn.subTotal).toFixed(2);
            }

            /* If subtotal is less than 0 then make it 1 */
            if (dataToReturn.subTotal <= 0) {
                dataToReturn.subTotal = Number(1).toFixed(2);
            }
        }

        /* Calculate Tax */
        dataToReturn.tax = +((dataToReturn.subTotal) * (checkPackage.taxAmount / 100)).toFixed(2);

        dataToReturn.total = +(dataToReturn.subTotal + dataToReturn.tax).toFixed(2);

        if (request.query.isFinal) {
            let currency, notes;

            try {
                currency = await codeSchema.CodeSchema.findOne({countryISOName: checkPackage.country}, {currencyName: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in getting currency data in new calculate pricing handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if ((request.query.isAddOn || request.query.isWallet) && request.query.subscriptionId) {
                let checkSubscription;

                /* Check if subscription exists */
                try {
                    checkSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: request.query.subscriptionId}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding existing subscription data in new calculate pricing handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!checkSubscription) {
                    return h.response(responseFormatter.responseFormatter({}, 'Invalid subscription', 'error', 400)).code(400);
                } else if (!checkSubscription.isActive) {
                    return h.response(responseFormatter.responseFormatter({}, 'You don\'t have any active subscription', 'error', 400)).code(400);
                }
                notes = {
                    customerId: checkUser._id,
                    customerName: checkUser.firstName + ' ' + checkUser.lastName,
                    email: checkUser.email,
                    phone: checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'NA',
                    type: request.query.isAddOn ? 'Add-on' : 'Wallet Recharge'
                };

                const order = await rzrPay.Handler.createOrder(dataToReturn.total * 100, currency.currencyName, notes);
                if (order.statusCode && order.statusCode !== 200) {
                    return h.response(responseFormatter.responseFormatter({}, order.error.error.description, 'error', order.statusCode)).code(order.statusCode);
                }

                const addOnsToAdd = {
                    features: request.query.features || [],
                    orderId: order.id,
                    type: request.query.isAddOn ? 'addOn' : 'wallet',
                    rechargeAmount: request.query.rechargeAmount || 0,
                    isPaid: false
                };

                try {
                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: request.query.subscriptionId}, {$push: {addOns: addOnsToAdd}});
                } catch (e) {
                    logger.error('Error occurred in updating existing subscription data in new calculate pricing handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                dataToReturn.orderId = addOnsToAdd.orderId;
                dataToReturn.subscriptionId = request.query.subscriptionId;

            } else {
                let expiresAt, order, activeJobs, existingSubscription;
                expiresAt = new Date(moment.tz("America/New_York").add(checkPackage.validity > 0 ? checkPackage.validity : 40000, 'days'));

                notes = {
                    customerId: checkUser._id,
                    customerName: checkUser.firstName + ' ' + checkUser.lastName,
                    email: checkUser.email,
                    phone: checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'NA'
                };

                const amount = dataToReturn.total * 100;

                order = await rzrPay.Handler.createOrder(amount, currency.currencyName, notes);
                if (order.statusCode && order.statusCode !== 200) {
                    return h.response(responseFormatter.responseFormatter({}, order.error.error.description, 'error', order.statusCode)).code(order.statusCode);
                }

                /* Get posted jobs */
                try {
                    activeJobs = await jobSchema.jobSchema.countDocuments({
                        userId: mongoose.Types.ObjectId(request.query.userId),
                        isArchived: false,
                        isTranslated: false,
                        isVisible: true
                    });
                } catch (e) {
                    logger.error('Error occurred finding active jobs count information in new calculate pricing handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Save subscription in database */
                const packageId = checkPackage._id;
                delete checkPackage._id;

                let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPackage);
                delete subscriptionToSave.createdAt;
                delete subscriptionToSave.updatedAt;
                subscriptionToSave.isActive = false;
                subscriptionToSave.userId = request.query.userId;
                subscriptionToSave.packageId = packageId;
                subscriptionToSave.expiresAt = expiresAt ? expiresAt : undefined;
                subscriptionToSave.orderId = order ? order.id : '';
                subscriptionToSave.taxAmount = checkPackage.taxAmount;
                subscriptionToSave.taxType = checkPackage.taxType
                subscriptionToSave.totalAmountPaid = dataToReturn.total;
                subscriptionToSave.isExtend = !!request.query.isExtend;
                subscriptionToSave.walletAmount = checkPackage.isWallet ? checkPackage.total * request.query.quantity : 0;
                subscriptionToSave.quantity = request.query.quantity || 1;
                subscriptionToSave.promoCode = checkPromo ? checkPromo.promoCode : '';
                subscriptionToSave.isPromoApplied = !!checkPromo.promoCode;

                /* Check for number of quantity */
                for (const feat in checkPackage) {
                    if (typeof checkPackage[feat] === 'object' && checkPackage[feat].allowQuantity) {
                        if (feat === 'numberOfJobs') {
                            subscriptionToSave[feat].count = (subscriptionToSave[feat].count * request.query.quantity) - activeJobs;
                        } else {
                            subscriptionToSave[feat].count = subscriptionToSave[feat].count * request.query.quantity;
                        }
                    }
                }

                dataToReturn.subscriptionId = subscriptionToSave._id;
                dataToReturn.orderId = order ? order.id : '';

                if (subscriptionToSave.isWallet) {
                    subscriptionToSave.numberOfJobs.count = 0;
                    subscriptionToSave.numberOfViews.count = 0;
                    subscriptionToSave.numberOfJobTranslations.count = 0;
                    subscriptionToSave.numberOfTextTranslations.count = 0;
                    subscriptionToSave.numberOfUsers.count = 0;
                }

                try {
                    await subscriptionToSave.save();
                } catch (e) {
                    logger.error('Error occurred saving subscription information in new calculate pricing handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Send email to the app support for the created subscription */
                if (process.env.NODE_ENV === 'production') {
                    let companyType, constant;

                    try {
                        constant = await constantSchema.constantSchema.findOne({}, {businessTypes: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error in finding constant data in new calculate pricing handler %s:', JSON.stringify(e));
                    }

                    if (constant.businessTypes) {
                        const idx = constant.businessTypes.findIndex(k => k._id.toString() === checkUser.employerInformation.companyType);
                        if (idx !== -1) {
                            companyType = constant.businessTypes[idx].name;
                        }
                    }

                    const mailOptions = {
                        from: 'support@ezjobs.io',
                        to: 'sales@ezjobs.io',
                        subject: 'Payment screen visited',
                        text: 'Email: ' + checkUser.email + '\n' +
                            'Name: ' + checkUser.firstName + ' ' + checkUser.lastName + '\n' +
                            'Phone: ' + checkUser.employerInformation.countryCode + (checkUser.employerInformation.companyPhone ? checkUser.employerInformation.companyPhone : 'N/A') + '\n' +
                            'Package: ' + checkPackage.packageName + '\n' +
                            'Price: ' + checkPackage.total + '\n' +
                            'Company Name: ' + checkUser.employerInformation.companyName + '\n' +
                            'Company Type: ' + (companyType ? companyType : 'NA') + '\n' +
                            'Payment Type: One-time'
                    };
                    try {
                        await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
                    } catch (e) {
                        logger.error('Error in sending email to support in new calculate pricing handler %s:', JSON.stringify(e));
                    }

                    let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(checkUser.email, [{
                        property: 'plan_visited',
                        value: checkPackage.packageName
                    }, {property: 'plan_visited_date', value: new Date().setHours(0, 0, 0, 0)}]);
                    if (statusEmployer === 404) {
                        console.log('HubSpot contact not found');
                    }

                }

                let source, contactSource, checkContact;

                if (process.env.NODE_ENV === 'production') {
                    if (checkUser.facebookId.id) {
                        source = 'Facebook';
                    } else if (checkUser.googleId.id) {
                        source = 'Google';
                    } else if (checkUser.linkedInId.id) {
                        source = 'Linkedin';
                    } else if (checkUser.phone) {
                        source = 'Phone';
                    } else {
                        source = 'Email';
                    }
                    if (checkUser.deviceType.toLowerCase() === 'android') {
                        contactSource = 'Android App';
                    } else if (checkUser.deviceType.toLowerCase() === 'ios') {
                        contactSource = 'IOS App';
                    } else {
                        contactSource = 'Web';
                    }

                    /* Engage Bay */
                    try {
                        checkContact = await commonFunctions.Handlers.checkEngageBayContact(checkUser.email);
                    } catch (e) {
                        logger.error('Error occurred while checking contact existence %s:', e);
                    }

                    if (checkContact && checkContact.status !== 200) {
                        let contactProperties = [], contactData = {
                            properties: [],
                            companyIds: []
                        }, checkCompany;

                        const firstName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.firstName);
                        contactProperties.push(firstName.getProperties());

                        const lastName = new commonFunctions.engageBay('last_name', 'TEXT', 'SYSTEM', true, checkUser.lastName);
                        contactProperties.push(lastName.getProperties());

                        const email = new commonFunctions.engageBay('email', 'TEXT', 'SYSTEM', true, checkUser.email);
                        contactProperties.push(email.getProperties());

                        const phone = new commonFunctions.engageBay('phone', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.countryCode + checkUser.employerInformation.companyPhone);
                        contactProperties.push(phone.getProperties());

                        const engageSource = new commonFunctions.engageBay('Source', 'TEXT', 'CUSTOM', true, source);
                        contactProperties.push(engageSource.getProperties());

                        const engageContactSource = new commonFunctions.engageBay('Contact source', 'TEXT', 'CUSTOM', true, contactSource);
                        contactProperties.push(engageContactSource.getProperties());

                        contactData.properties = contactProperties;

                        if (checkUser.employerInformation.companyName) {
                            try {
                                checkCompany = await commonFunctions.Handlers.checkEngageBayCompany(checkUser.employerInformation.companyName);
                            } catch (e) {
                                logger.error('Error occurred while checking company existence %s:', e);
                            }

                            if (!checkCompany) {
                                /* Create company in Engage Bay */
                                let company, companyProperties = [], companyData = {
                                    properties: []
                                };

                                const engageCompanyName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.companyName);
                                companyProperties.push(engageCompanyName.getProperties());

                                companyData.properties = companyProperties;

                                try {
                                    company = await commonFunctions.Handlers.createEngageBayCompany(companyData);
                                } catch (e) {
                                    logger.error('Error occurred while creating company data %s:', e);
                                }

                                if (company.status === 200) {
                                    contactData.companyIds.push(company.data.id);
                                }

                            } else if (checkCompany.id) {
                                contactData.companyIds.push(checkCompany.id);
                            }
                        }

                        try {
                            checkContact = await commonFunctions.Handlers.createEngageBayContact(contactData);
                        } catch (e) {
                            logger.error('Error occurred while creating contact data %s:', e);
                        }

                    }
                }

                /* Update package info on hubspot */
                if (process.env.NODE_ENV === 'production') {
                    let engageBayProperties = [];

                    const planVisited = new commonFunctions.engageBay('Plan_visited', 'TEXT', 'CUSTOM', true, checkPackage.packageName);
                    engageBayProperties.push(planVisited.getProperties());

                    const planVisitedDate = new commonFunctions.engageBay('Plan_visited_date', 'DATE', 'CUSTOM', true, new Date().toLocaleDateString());
                    engageBayProperties.push(planVisitedDate.getProperties());

                    if (engageBayProperties.length) {
                        try {
                            await commonFunctions.Handlers.updateEngageBayContact({
                                id: checkContact.data.id,
                                properties: engageBayProperties
                            });
                        } catch (e) {
                            logger.error('Error occurred while updating user in engage bay %s:', JSON.stringify(e));
                        }
                    }
                }
            }
        }

        return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
    };

    module.exports = {
        Handler: handler
    }

    /*68.66.236.170*/

})();
