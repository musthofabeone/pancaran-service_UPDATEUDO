const config = require('./config');
var moment = require('moment'); // untuk definisi tanggal
const nodeFetch = require('node-fetch')
const { Pool } = require('pg') // untuk postgresql
const fetch = require('fetch-cookie')(nodeFetch);
const connection = require('./conn');
const cron = require('node-cron');
const { AbortController } = require('node-abort-controller');
const fs = require('fs');
const logger = require('./logger');
const { resolve } = require('path');
const { baseUrlLoginSL } = require('./config');
const { Logger } = require('winston');
const CronJob = require('cron').CronJob;
const { base64encode, base64decode } = require('nodejs-base64');
const base64 = require('base-64');
const crypto = require('crypto');
const privateKey = fs.readFileSync('./pancaran-pg-sap-dev.key');




// create pool
const pool = new Pool({
    name: 'service_payment',
    user: 'h2hadm',
    host: '10.10.16.58',
    database: 'saph2h',
    password: 'susujahe',
    port: 5090,
});

// PostgreSql Query Adapter
async function executeQuery(query, queryparams) {
    return new Promise((resolve, reject) => {
        pool.getConnection(function (err, connection) {
            if (err) {
                consoleLog(moment().format('YYYY-MM-DD h:mm:ss a') + ": ");
                consoleLog("Get POsgresQL Connection failed");
                consoleLog(err);
                reject(err);
            } else {
                connection.query(query, queryparams,
                    function (error, rows, fields) {
                        if (error) {
                            consoleLog(moment().format('YYYY-MM-DD h:mm:ss a') + ": ");
                            consoleLog("POsgresQL Query failed");
                            consoleLog(error);
                            reject(error);
                        } else {
                            // consoleLog(this.sql); // Debug
                            resolve(rows);
                        }
                    });
                if (connection) {
                    connection.release();
                }
            }
        });
    })
}


let taskRunning = false

const jobs = new CronJob({
    cronTime: '*/10 * * * * *',
    onTick: async () => {
        try {
            main()
        } catch (err) {
            jobs.start()
        }

    },
    start: true,
    timeZone: 'UTC'
})



var count = 0;
async function main() {
    logger.debug('Service Update Status Line & Inquiry Payment ........');
    let result = null
    let resultInquiry = null
    try {
        var start = new Date();
        jobs.stop()

        result = await connection.query('SELECT DISTINCT * FROM paymenth2h."BOS_UDO_STATUS_UPDATE" WHERE "DATE" = $1 AND "DONEALL" = \'N\'  ORDER BY "DOCENTRY"', [moment(new Date()).format("yyyyMMDD")])
        const timer = ms => new Promise(res => setTimeout(res, ms))
        if (result.rowCount > 0) {
            for (var data of result.rows) {
                count++;
                if (data.TYPE == 'OUT') {
                    logger.debug(config.base_url_xsjs + "/PaymentService/get_details_pymout.xsjs?DocEntry=" + data.DOCENTRY + "&Reff=" + data.REFF + "&dbName=" + data.DBNAME)
                    fetch(config.base_url_xsjs + "/PaymentService/get_details_pymout.xsjs?DocEntry=" + data.DOCENTRY + "&Reff=" + data.REFF + "&dbName=" + data.DBNAME, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Basic ' + config.auth_basic,
                            'Cookie': 'sapxslb=0F2F5CCBA8D5854A9C26CB7CAD284FD1; xsSecureId1E75392804D765CC05AC285536FA9A62=14C4F843E2445E48A692A2D219C5C748'
                        },
                        'maxRedirects': 20
                    })
                        .then(res => res.json())
                        .then(dataDetail => {
                            var Entry = ""
                            console.log(dataDetail.HEADER.length)
                            //logger.info("(IN) Middleware - SAP  (" + dbName + "): GET Dockey UDO Result ", data)
                            Object.keys(dataDetail.HEADER).forEach(async function (key) {
                                let result1 = await connection.query('SELECT DISTINCT CASE WHEN "STATUS" = \'0\' AND "REASON" = \'SAP - Success Generate Outgoing Payment\' THEN \'Success\' ' +
                                    'WHEN "STATUS" = \'0\' AND "REASON" = \'Mobopay OK - Payment Success\' THEN \'Process\' ' +
                                    'WHEN "STATUS" = \'4\' THEN \'Failed\' ' +
                                    'WHEN "STATUS" = \'5\' THEN \'Failed\' END AS "STATUS", "TRXID", "PAYMENTOUTTYPE", "REFERENCY"  FROM( ' +
                                    'SELECT ROW_NUMBER() OVER (ORDER BY "TRANSDATE" ,"TRANSTIME") "ROWNUMBER" ' +
                                    ', * FROM paymenth2h."BOS_LOG_TRANSACTIONS" WHERE "REFERENCY" = $1) X0 ' +
                                    'WHERE "ROWNUMBER" = (SELECT MAX("ROWNUMBER")  FROM( ' +
                                    'SELECT ROW_NUMBER() OVER (ORDER BY "TRANSDATE" ,"TRANSTIME") "ROWNUMBER" ' +
                                    'FROM paymenth2h."BOS_LOG_TRANSACTIONS" WHERE "REFERENCY" = $1) T0 )', [dataDetail.HEADER[key].REFF])

                                //logger.info(result.rowCount)
                                if (result1.rowCount > 0) {
                                    for await (var dataLog of result1.rows) {
                                        logger.info("Payment Out, Database ( " + data.DBNAME + " ), Reff: " + dataLog.REFERENCY + "-> Log status = " + dataLog.STATUS + ", Udo Status = " + dataDetail.HEADER[key].STATUS)
                                        if (dataLog.STATUS !== "Process") {
                                            //logger.info("Payment Out, Database ( " + data.DBNAME + " ), Reff: " + dataLog.REFERENCY + "-> Log status = " + dataLog.STATUS + ", Udo Status = " + dataDetail.HEADER[key].STATUS)
                                            var update = null;
                                            if (dataLog.STATUS != dataDetail.HEADER[key].STATUS) {

                                                // Login ke SL
                                                var Login = await LoginSL(data.DBNAME)
                                                if (Login !== "LoginError") {
                                                    if (dataLog.STATUS == "Success") {
                                                        update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", "", "OUT")
                                                        logger.info(update)
                                                    } else if (dataLog.STATUS == "Failed") {
                                                        update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "Y", "", "OUT")
                                                        logger.info(update)
                                                    }
                                                }


                                            } else if (dataLog.TRXID != dataDetail.HEADER[key].TRXID) {
                                                // Login ke SL
                                                var Login = await LoginSL(data.DBNAME)
                                                if (Login !== "LoginError") {
                                                    if (dataLog.STATUS == "Success") {
                                                        update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", "", "OUT")
                                                        logger.info(update)
                                                    } else if (dataLog.STATUS == "Failed") {
                                                        update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "Y", "", "OUT")
                                                        logger.info(update)
                                                    }
                                                }

                                            }

                                            if (dataLog.STATUS == dataDetail.HEADER[key].STATUS && dataLog.STATUS != 'Process') {
                                                let update = await connection.query('UPDATE paymenth2h."BOS_UDO_STATUS_UPDATE" SET "DONEALL" = \'Y\' WHERE "DBNAME" = $1 AND "DOCENTRY" = $2 AND "TYPE" = \'OUT\' AND "REFF" = $3', [data.DBNAME, dataDetail.HEADER[key].DOCENTRY, data.REFF])
                                                logger.info("Update Success")
                                            }
                                            //continue;
                                        }
                                    }
                                }
                            })
                        })
                        .catch(err => {
                            logger.error("Get Error: " + err.message)
                        });
                } else if (data.TYPE == 'OUTSTATUS') {
                    fetch(config.base_url_xsjs + "/PaymentService/get_detail_pymoutstatus.xsjs?DocEntry=" + data.DOCENTRY + "&Reff=" + data.REFF + "&dbName=" + data.DBNAME, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Basic ' + config.auth_basic,
                            'Cookie': 'sapxslb=0F2F5CCBA8D5854A9C26CB7CAD284FD1; xsSecureId1E75392804D765CC05AC285536FA9A62=14C4F843E2445E48A692A2D219C5C748'
                        },
                        'maxRedirects': 20
                    })
                        .then(res => res.json())
                        .then(async dataDetail => {
                            var Entry = ""
                            //logger.info("(IN) Middleware - SAP  (" + dbName + "): GET Dockey UDO Result ", data)
                            await Object.keys(dataDetail.HEADER).forEach(async function (key) {
                                let result1 = await connection.query('SELECT CASE WHEN "STATUS" = \'0\' AND "REASON" = \'SAP - Success Generate Outgoing Payment\' THEN \'Success\' ' +
                                    'WHEN "STATUS" = \'0\' AND "REASON" = \'Mobopay OK - Payment Success\' THEN \'Process\' ' +
                                    'WHEN "STATUS" = \'4\' THEN \'Failed\' ' +
                                    'WHEN "STATUS" = \'5\' THEN \'Failed\' END AS "STATUS", "TRXID", "PAYMENTOUTTYPE", "REFERENCY", "PAYMENTNO"  FROM( ' +
                                    'SELECT ROW_NUMBER() OVER (ORDER BY "TRANSDATE" ,"TRANSTIME") "ROWNUMBER" ' +
                                    ', * FROM paymenth2h."BOS_LOG_TRANSACTIONS" WHERE "REFERENCY" = $1) X0 ' +
                                    'WHERE "ROWNUMBER" = (SELECT MAX("ROWNUMBER")  FROM( ' +
                                    'SELECT ROW_NUMBER() OVER (ORDER BY "TRANSDATE" ,"TRANSTIME") "ROWNUMBER" ' +
                                    'FROM paymenth2h."BOS_LOG_TRANSACTIONS" WHERE "REFERENCY" = $1) T0 )', [dataDetail.HEADER[key].REFF])

                                //logger.info(result.rowCount)
                                if (result1.rowCount > 0) {
                                    for (var dataLog of result1.rows) {

                                        if (data.TYPE == 'OUTSTATUS') {
                                            logger.info("Payment Out Status, Database ( " + data.DBNAME + " ), Reff: " + dataLog.REFERENCY + "-> Log status = " + dataLog.STATUS + ", Udo Status = " + dataDetail.HEADER[key].STATUS)
                                            var Login = await LoginSL(data.DBNAME);
                                            if (Login !== "LoginError") {
                                                if (dataLog.STATUS != dataDetail.HEADER[key].STATUS) {
                                                    if (dataLog.STATUS == "Success") {
                                                        var update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", dataLog.PAYMENTNO, "OUTSTATUS")
                                                        logger.info(update)

                                                        if (update == "Success") {
                                                            var updateOut = await updateUDO_("OUT", dataDetail.HEADER[key].LineOut, dataDetail.HEADER[key].Entryout
                                                                , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", dataLog.PAYMENTNO, "OUTSTATUS");

                                                            var countfailed = await getCountFail(dataDetail.HEADER[key].DOCENTRY, data.DBNAME);
                                                        }
                                                    } if (dataLog.STATUS == "Failed") {
                                                        var update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "Y", dataLog.PAYMENTNO, "OUTSTATUS")
                                                        logger.info(update)
                                                        if (update == "Success") {
                                                            var updateOut = await  updateUDO_("OUT", dataDetail.HEADER[key].LineOut, dataDetail.HEADER[key].Entryout
                                                                , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", dataLog.PAYMENTNO, "OUTSTATUS");

                                                        }
                                                    }
                                                    if (dataLog.STATUS == "Process") {
                                                        var update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "Process", dataLog.PAYMENTNO, "OUTSTATUS")
                                                        logger.info(update)
                                                    }
                                                } else if (dataLog.TRXID != dataDetail.HEADER[key].TRXID) {
                                                    if (dataLog.STATUS == "Success") {
                                                        var update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", dataLog.PAYMENTNO, "OUTSTATUS")
                                                        logger.info(update)
                                                        if (update == "Success") {
                                                            var updateOut = await  updateUDO_("OUT", dataDetail.HEADER[key].LineOut, dataDetail.HEADER[key].Entryout
                                                                , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", dataLog.PAYMENTNO, "OUTSTATUS");

                                                            var countfailed = await getCountFail(dataDetail.HEADER[key].DOCENTRY, data.DBNAME);
                                                        }
                                                    } else if (dataLog.STATUS == "Failed") {
                                                        var update = await updateUDO_(data.TYPE, dataDetail.HEADER[key].LINEID, dataDetail.HEADER[key].DOCENTRY
                                                            , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "Y", dataLog.PAYMENTNO, "OUTSTATUS")
                                                        logger.info(update)
                                                        if (update == "Success") {
                                                            var updateOut = await  updateUDO_("OUT", dataDetail.HEADER[key].LineOut, dataDetail.HEADER[key].Entryout
                                                                , "", "", "", "", dataLog.TRXID, dataLog.REFERENCY, data.DBNAME, "N", dataLog.PAYMENTNO, "OUTSTATUS");

                                                        }
                                                    }
                                                }
                                                if (dataLog.STATUS == dataDetail.HEADER[key].STATUS && dataLog.STATUS != 'Process') {
                                                    await connection.query('UPDATE paymenth2h."BOS_UDO_STATUS_UPDATE" SET "DONEALL" = \'Y\' WHERE "DBNAME" = $1 AND "DOCENTRY" = $2 AND "TYPE" = \'OUTSTATUS\' AND "REFF" = $3', [data.DBNAME, dataDetail.HEADER[key].DOCENTRY, data.REFF])
                                                }
                                            }

                                        }
                                    }
                                }
                            })
                        })
                        .catch(err => {
                            logger.error("Get Error: " + err.message)
                        });
                }
                await timer(5000)
            }
        }

        if (result.rowCount === count) {
            logger.info("Update UDO Finished")
        }
        jobs.start()
    }
    catch (err) {
        logger.error(err)
    }

}


const statusInquiry = (customerReffNumber) => {
    return new Promise(async (resolve, reject) => {

        var start = new Date();
        var date = moment(start).format("yyyy-MM-DDTHH:mm:ss.SSS") + "Z"

        let result = null
        result = await connection.query('SELECT X1.*, X0."PAYMENTNO" FROM paymenth2h."BOS_TRANSACTIONS" X0 ' +
            'INNER JOIN paymenth2h."BOS_DB_LIST" X1 ON X0."DB" = X1."NM_DB" AND X0."CLIENTID" = X1."ID_DB" ' +
            'WHERE X0."REFERENCY" = $1', [customerReffNumber]);

        if (result.rowCount > 0) {

            for (let data of result.rows) {

                let _clientId = data.ID_DB
                let _bodyToken = await base64encode(data.CUST_KEY + ":" + data.CUST_SECRET);
                let _token = await getToken(_bodyToken)
                let _signature = await signature(_clientId + data.CLIENT_SECRET + date + customerReffNumber)

                var header = {
                    "Authorization": "Bearer " + _token,
                    "X-Client-Id": _clientId,
                    "X-Timestamp": date,
                    "X-Signature": _signature,
                    "Content-Type": "application/json"
                }


                var body = {
                    originalCustomerReferenceNumber: customerReffNumber,
                }

                var raw = JSON.stringify(body);

                var requestOptions = {
                    method: 'POST',
                    headers: header,
                    body: raw
                };

                logger.info(requestOptions)
                const fetchWithTimeout = (input, init, timeout) => {
                    const controller = new AbortController();
                    setTimeout(() => {
                        controller.abort();
                    }, timeout)

                    return fetch(input, { signal: controller.signal, ...init });
                }


                const fetchWithRetry = async (input, init, timeout, retries) => {
                    let increseTimeOut = config.interval_retries;
                    let count = retries;

                    while (count > 0) {
                        try {
                            return await fetchWithTimeout(input, init, timeout);
                        } catch (e) {
                            if (e.name !== "AbortError") throw e;
                            count--;
                            logger.error(
                                `fetch failed Cusreff: ${referency}, retrying in ${increseTimeOut}s, ${count} retries left`
                            );
                        }
                    }
                }
                logger.info("(OUT) Middleware - Mobopay : Inquiry Status Payment : " + customerReffNumber + " -> Url: " + config.base_url_payment + "/mobopay/mandiri/inquiry/inquiry-transaction-status")

                return fetchWithRetry(config.base_url_payment + "/mobopay/mandiri/inquiry/inquiry-transaction-status", requestOptions, config.timeOut, config.max_retries)
                    .then(response => response.text())
                    .then(async result => {
                        logger.debug(result)
                        const resultBody = JSON.parse(result)
                        logger.error("Inquiry Error: " + resultBody.message)
                        // if (resultBody.resultCode == "0") {
                        //     await connection.query('INSERT INTO paymenth2h."BOS_LOG_TRANSACTIONS"("PAYMENTOUTTYPE", "PAYMENTNO", "TRXID", "REFERENCY", "VENDOR", "ACCOUNT", "AMOUNT", "TRANSDATE", "TRANSTIME", "STATUS", "REASON", "BANKCHARGE", "FLAGUDO", "SOURCEACCOUNT", "TRANSFERTYPE", "CLIENTID", "ERRORCODE")' +
                        //         'SELECT "PAYMENTOUTTYPE", "PAYMENTNO","TRXID", "REFERENCY", "VENDOR", "ACCOUNT", "AMOUNT", $3, $4, 4, $1, "BANKCHARGE", "FLAGUDO", "SOURCEACCOUNT", "TRANSFERTYPE", "CLIENTID",  $5' +
                        //         'FROM paymenth2h."BOS_TRANSACTIONS" WHERE "REFERENCY" = $2 limit 1', [resultBody.message, customerReffNumber, moment(start).format("yyyyMMDD"), moment(start).format("HH:mm:ss"), resultBody.errorCode], async function (error, result, fields) {
                        //             if (error) {
                        //                 logger.error(error)
                        //             } else {
                        //             }
                        //         });

                        //     resolve({ success: "error", trxId : "" })
                        // }
                        // else if (resultBody.resultCode == "1") {
                        //     await connection.query('INSERT INTO paymenth2h."BOS_LOG_TRANSACTIONS"("PAYMENTOUTTYPE", "PAYMENTNO", "TRXID", "REFERENCY", "VENDOR", "ACCOUNT", "AMOUNT", "TRANSDATE", "TRANSTIME", "STATUS", "REASON", "BANKCHARGE", "FLAGUDO", "SOURCEACCOUNT", "TRANSFERTYPE", "CLIENTID")' +
                        //         'SELECT "PAYMENTOUTTYPE", "PAYMENTNO", TRXID, "REFERENCY", "VENDOR", "ACCOUNT", "AMOUNT", $3, $4, 0, $5, "BANKCHARGE", "FLAGUDO", "SOURCEACCOUNT", "TRANSFERTYPE", "CLIENTID"' +
                        //         'FROM paymenth2h."BOS_TRANSACTIONS" WHERE "REFERENCY" = $2 limit 1', ["", customerReffNumber, moment(start).format("yyyyMMDD"), moment(start).format("HH:mm:ss"), 'Mobopay OK - Payment Success'], async function (error, result, fields) {
                        //             if (error) {
                        //                 logger.error(error)
                        //             } else {
                        //                 await connection.query('UPDATE paymenth2h."BOS_TRANSACTIONS" SET "INTERFACING" = \'1\', "SUCCESS" = \'Y\', "TRXID" = $2 WHERE "REFERENCY" = $1', [referency, resultBody.data.trxId])

                        //             }
                        //         });

                        //     resolve({ success: "success", trxid: "" })
                        // }
                    })
                    .catch(async err => {
                        logger.error(err)
                    }
                    )
                    .finally(() => {
                        clearTimeout(timeout);
                    });
            }
        }

    });
};

async function notConfirmedInterval(reference, db, outType, trxId) {
    var start = new Date();
    // insert ke log jika terkena cutoff

    connection.query('SELECT COUNT(*) "DATACOUNT" FROM paymenth2h."BOS_LOG_TRANSACTIONS" WHERE "REFERENCY" = $1 AND ("ERRORCODE" = \'EOD\' OR "REASON" = \'Transaction Not Confirmed\')', [reference], async function (error, result, fields) {
        if (error) {
            logger.error(error)
        } else {
            for (var data of result.rows) {
                //logger.info(data.CUTOFF)
                if (data.DATACOUNT < 1) {
                    await connection.query('UPDATE paymenth2h."BOS_TRANSACTIONS" SET "CUTOFF" = \'Y\', "INTERFACING" = \'1\', "SUCCESS" = \'N\' WHERE "REFERENCY" = $1', [reference])
                    await getEntryUdoOut(reference, db, trxId, outType, "Y")
                    await connection.query('INSERT INTO paymenth2h."BOS_LOG_TRANSACTIONS"("PAYMENTOUTTYPE", "PAYMENTNO", "TRXID", "REFERENCY", "VENDOR", "ACCOUNT", "AMOUNT", "TRANSDATE", "TRANSTIME", "STATUS", "REASON", "BANKCHARGE", "FLAGUDO", "SOURCEACCOUNT", "TRANSFERTYPE", "CLIENTID", "ERRORCODE")' +
                        'SELECT "PAYMENTOUTTYPE", "PAYMENTNO","TRXID", "REFERENCY", "VENDOR", "ACCOUNT", "AMOUNT", $3, $4, 4, $1, "BANKCHARGE", "FLAGUDO", "SOURCEACCOUNT", "TRANSFERTYPE", "CLIENTID",  $5' +
                        'FROM paymenth2h."BOS_TRANSACTIONS" WHERE "REFERENCY" = $2 limit 1', ["Transaction Not Confirmed", reference, moment(start).format("yyyyMMDD"), moment(start).format("HH:mm:ss"), "EOD"], function (error, result, fields) {
                            if (error) {
                                logger.error("insert log error: " + error)
                            }
                        });


                } else {
                    logger.info("Ref (" + db + "): " + reference + ", Cutt Off: " + data.CUTOFF + " Already Updated")
                }
            }
        }
    });



}

async function getEntryUdoOut(referency, dbName, trxId, outType, error) {
    // update ke UDO jika sudah mendapatakan trxid
    var start = new Date()
    //logger.info("Mencari DocEntry UDO, Payment Out Type: " + outType + "Ref: " + referency)

    var refr = []
    refr = referency.split('/')

    // mencari docentry dari payout
    logger.info("(OUT) Middleware - SAP  (" + dbName + "): GET Dockey UDO " + config.base_url_xsjs + "/PaymentService/getEntryOut.xsjs?docnum=" + referency + "&dbName=" + dbName)
    fetch(config.base_url_xsjs + "/PaymentService/getEntryOut.xsjs?docnum=" + referency + "&dbName=" + dbName, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + config.auth_basic,
            'Cookie': 'sapxslb=0F2F5CCBA8D5854A9C26CB7CAD284FD1; xsSecureId1E75392804D765CC05AC285536FA9A62=14C4F843E2445E48A692A2D219C5C748'
        },
        'maxRedirects': 20
    })
        .then(res => res.json())
        .then(async data => {
            var Entry = ""
            logger.info("(IN) Middleware - SAP  (" + dbName + "): GET Dockey UDO Result ", data)
            await Object.keys(data.ENTRY).forEach(async function (key) {

                // if (data.ENTRY[key].OUTYPE == 'OUT') {
                //   updateUdoTrxId(data.ENTRY[key].DocEntry, data.ENTRY[key].LineId, trxId, 'Basic ' + config.auth_basic, dbName, referency, data.ENTRY[key].OUTYPE, error)
                // } else {
                //   updateUdoTrxId(data.ENTRY[key].DocEntry, data.ENTRY[key].LineId, trxId, 'Basic ' + config.auth_basic, dbName, referency, data.ENTRY[key].OUTYPE, error)
                // }

                updateUdoTrxId(data.ENTRY[key].DocEntry, data.ENTRY[key].LineId, trxId, 'Basic ' + config.auth_basic, dbName, referency, data.ENTRY[key].OUTYPE, error)
            })
        })
        .catch(err => {
            logger.error("Get Error: " + err.message)
        });
}

async function updateUdoTrxId(DocEntry, Lines, trxid, auth, dbName, referency, outType, error) {

    // mendapatakan detail dari pym out
    let login = await LoginV2(dbName);


    if (outType == "OUT") {

        //logger.info("Line Out: " + Lines + ", Entry: " + DocEntry)
        logger.info("(OUT) Mobopay - SAP  (" + dbName + "): GET Lines Detail UDO Payment Out" + config.base_url_xsjs + "/PaymentService/get_lines_out.xsjs?Entry=" + DocEntry + "&LineId=" + Lines + "&dbName=" + dbName)
        await fetch(config.base_url_xsjs + "/PaymentService/get_lines_out.xsjs?Entry=" + DocEntry + "&LineId=" + Lines + "&dbName=" + dbName, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': auth,
                'Cookie': 'sapxslb=0F2F5CCBA8D5854A9C26CB7CAD284FD1; xsSecureId1E75392804D765CC05AC285536FA9A62=14C4F843E2445E48A692A2D219C5C748'
            },
            'maxRedirects': 20
        })
            .then(res => res.json())
            .then(async data => {
                await Object.keys(data.LINES).forEach(function (key) {
                    var d = data.LINES[key];
                    var row = {}
                    details = []
                    if (trxid == "") {
                        row = {
                            'LineId': parseFloat(Lines),
                            'U_STATUS': 'Failed',
                            'U_PROSES_TYPE': d.ProcessType,
                            'U_ACCT_PYM_REQ': d.PaymentMeans,
                            'U_BANK_PYM_REQ': d.BankPaymentMeans,
                            'U_SOURCEACCT': d.SourcePayment,
                            'U_CUST_REFF': referency,
                            'U_TRXID_SAP': trxid,
                        }
                    }
                    if (trxid != "") {
                        if (error == "Y") {
                            row = {
                                'LineId': parseFloat(Lines),
                                'U_TRXID_SAP': trxid,
                                'U_STATUS': 'Failed'
                            }
                        } else {
                            row = {
                                'LineId': parseFloat(Lines),
                                'U_TRXID_SAP': trxid,
                            }
                        }
                    }

                    details.push(row)
                })
                logger.info("Middleware  (" + dbName + "): Details Payment Out", details)

                // login ke sap

                if (login != "") {
                    // update ke UDO
                    logger.info("Update UDO Payment Out, Ref: " + referency)

                    var myHeaders = new nodeFetch.Headers();
                    myHeaders.append("Content-Type", "application/json");

                    var requestOptions = {
                        method: 'PATCH',
                        headers: myHeaders,
                        body: JSON.stringify({ BOS_PYM_OUT1Collection: details }),
                        redirect: 'follow'
                    };

                    const fetchWithTimeout = (input, init, timeout) => {
                        const controller = new AbortController();
                        setTimeout(() => {
                            controller.abort();
                        }, timeout)

                        return fetch(input, { signal: controller.signal, ...init });
                    }

                    const wait = (timeout) =>
                        new Promise((resolve) => {
                            setTimeout(() => resolve(), timeout);
                        })

                    const fetchWithRetry = async (input, init, timeout, retries) => {
                        let increseTimeOut = config.interval_retries;
                        let count = retries;

                        while (count > 0) {
                            try {
                                return await fetchWithTimeout(input, init, timeout);
                            } catch (e) {
                                logger.info(e.name)
                                if (e.name !== "AbortError") throw e;
                                count--;
                                logger.error(
                                    `fetch patch, retrying patch in ${increseTimeOut}s, ${count} retries left`
                                );
                                await wait(increseTimeOut)
                            }
                        }
                    }
                    var Session = ""
                    logger.info("(OUT) Mobopay - SAP  (" + dbName + "): Update Flag UDO Payment Out " + config.base_url_SL + "/b1s/v2/PYM_OUT(" + parseFloat(DocEntry) + ")")

                    await fetchWithRetry(config.base_url_SL + "/b1s/v2/PYM_OUT(" + parseFloat(DocEntry) + ")", requestOptions, 60000, 3)
                        .then(response => {
                            if (response.status == 204) {
                                // connection.query('UPDATE paymenth2h."BOS_TRANSACTIONS" SET "FLAGUDO" = \'1\' WHERE "REFERENCY" = $1', [referency], async function (error, result, fields) {
                                //     if (error) {
                                //         logger.error(error)
                                //     }
                                // });
                            }
                            response.text()
                        }).then(async result => {
                            logger.info(result)
                            jobs.start()
                        }).catch(error => logger.error('error', error));
                }
            })
            .catch(err => {
                logger.error("Get Error: " + err.message)
            });
    } else {
        details = []
        //logger.info("Line Out Status: " + Lines + ", Entry: " + DocEntry)
        logger.info("(OUT) Mobopay - SAP  (" + dbName + "): GET Lines Detail UDO Payment Out Status" + config.base_url_xsjs + "/PaymentService/get_line_outstatus.xsjs?Entry=" + DocEntry + "&LineId=" + Lines + "&dbName=" + dbName)


        await fetch(config.base_url_xsjs + "/PaymentService/get_line_outstatus.xsjs?Entry=" + DocEntry + "&LineId=" + Lines + "&dbName=" + dbName, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': auth,
                'Cookie': 'sapxslb=0F2F5CCBA8D5854A9C26CB7CAD284FD1; xsSecureId1E75392804D765CC05AC285536FA9A62=14C4F843E2445E48A692A2D219C5C748'
            },
            'maxRedirects': 20
        })
            .then(res => res.json())
            .then(async data => {
                await Object.keys(data.LINES).forEach(function (key) {
                    var d = data.LINES[key];
                    var row = {}
                    if (trxid == "") {
                        row = {
                            'LineId': parseFloat(Lines),
                            'U_STATUS': 'Failed',
                            'U_TRXID_SAP': trxid
                        }
                        //details.push(row)
                    }
                    if (trxid != "") {
                        if (error == "Y") {
                            row = {
                                'LineId': parseFloat(Lines),
                                'U_STATUS': 'Failed',
                                'U_CUST_REFF': referency
                            }
                            //details.push(row)
                        } else {
                            row = {
                                'LineId': parseFloat(Lines),
                                'U_TRXID_SAP': trxid,
                                'U_CUST_REFF': referency
                            }
                        }
                    }

                    details.push(row)
                })
                logger.info("Middleware  (" + dbName + "): Details Payment Out Status", details)


                // login ke sap
                //let login = await LoginV2(dbName);
                if (login != "") {
                    // update ke UDO 
                    logger.info("Update UDO Payment Out Status, Reff:" + referency)

                    var myHeaders = new nodeFetch.Headers();
                    myHeaders.append("Content-Type", "application/json");

                    var requestOptions = {
                        method: 'PATCH',
                        headers: myHeaders,
                        body: JSON.stringify({ BOS_PYMOUT_STATUS1Collection: details }),
                        redirect: 'follow'
                    };

                    const fetchWithTimeout = (input, init, timeout) => {
                        const controller = new AbortController();
                        setTimeout(() => {
                            controller.abort();
                        }, timeout)

                        return fetch(input, { signal: controller.signal, ...init });
                    }

                    const wait = (timeout) =>
                        new Promise((resolve) => {
                            setTimeout(() => resolve(), timeout);
                        })

                    const fetchWithRetry = async (input, init, timeout, retries) => {
                        let increseTimeOut = config.interval_retries;
                        let count = retries;

                        while (count > 0) {
                            try {
                                return await fetchWithTimeout(input, init, timeout);
                            } catch (e) {
                                logger.info(e.name)
                                if (e.name !== "AbortError") throw e;
                                count--;
                                logger.error(
                                    `fetch patch, retrying patch in ${increseTimeOut}s, ${count} retries left`
                                );
                                await wait(increseTimeOut)
                            }
                        }
                    }
                    var Session = ""
                    logger.info("(OUT) Mobopay - SAP  (" + dbName + "): Update Flag UDO Payment Out Status" + config.base_url_SL + "/b1s/v2/PYMOUT_STATUS(" + parseFloat(DocEntry) + ")")
                    await fetchWithRetry(config.base_url_SL + "/b1s/v2/PYMOUT_STATUS(" + parseFloat(DocEntry) + ")", requestOptions, 60000, 3)
                        .then(response => {
                            if (response.status == 204) {
                                logger.info(response)
                                // connection.query('UPDATE paymenth2h."BOS_TRANSACTIONS" SET "FLAGUDO" = \'1\' WHERE "REFERENCY" = $1', [referency], async function (error, result, fields) {
                                //     if (error) {
                                //         logger.error(error)
                                //     }
                                // });
                            }
                            response.text()
                        }).then(async result => {
                            logger.info("(OUT) Mobopay - SAP  (" + dbName + "): Update Flag UDO Payment Out Status", result)
                            jobs.start()
                        }).catch(error => logger.error('error', error));
                }
            })
            .catch(err => {
                logger.error("Get Error: " + err.message)
            });
    }
    jobs.start();
}

const LoginSL = async (dbName) => {
    return new Promise((resolve, reject) => {
        var myHeaders = new nodeFetch.Headers();
        //var retries = 3;
        var backoff = 300;
        myHeaders.append("Authorization", "Basic " + config.auth_basic);
        myHeaders.append("Content-Type", "application/json");
        logger.info("(OUT) Middleware - Service Layer (" + dbName + "), Login : " + config.base_url_SL + "/b1s/v2/Login")
        var raw = JSON.stringify({
            "CompanyDB": dbName,
            "UserName": config.userName,
            "Password": config.Password
        });

        var requestOptions = {
            method: 'POST',
            headers: myHeaders,
            body: raw,
            redirect: 'follow'
        };

        const fetchWithTimeout = (input, init, timeout) => {
            const controller = new AbortController();
            setTimeout(() => {
                controller.abort();
            }, timeout)

            return fetch(input, { signal: controller.signal, ...init });
        }

        const wait = (timeout) =>
            new Promise((resolve) => {
                setTimeout(() => resolve(), timeout);
            })

        const fetchWithRetry = async (input, init, timeout, retries) => {
            let increseTimeOut = config.interval_retries;
            let count = retries;

            while (count > 0) {
                try {
                    return await fetchWithTimeout(input, init, timeout);
                } catch (e) {
                    if (e.name !== "AbortError") throw e;
                    count--;
                    logger.error(
                        `fetch Login, retrying login in ${increseTimeOut}s, ${count} retries left`
                    );
                    await wait(increseTimeOut)
                }
            }
        }

        var Session = ""
        var url = config.base_url_SL + "/b1s/v2/Login";
        const retryCodes = [408, 500, 502, 503, 504, 522, 524]
        return fetchWithRetry(url, requestOptions, config.timeOut, config.max_retries)
            .then(res => {
                //logger.debug(res.text())

                if (res.status == 200) return res.text()

            })
            .then(result => {
                if (result !== null) {
                    const resultBody = JSON.parse(result)
                    if (!resultBody.error) {
                        Session = resultBody.SessionId
                        logger.info("Login Service Layer: (" + dbName + ") Success")
                        resolve(Session);
                    } else {
                        logger.info("Error Login (" + dbName + ")", result);
                        resolve("LoginError")
                    }
                }

            })
            .catch(error => {
                logger.info('Error Login : ' + error)
                resolve("LoginError")
            });
    });
};


async function LoginV2(dbName) {
    var raw = JSON.stringify({
        "CompanyDB": dbName,
        "UserName": config.userName,
        "Password": config.Password
    });
    let breakTheLoop = false;
    var Session = ""
    for (config.sl_nextPort = 0; config.sl_nextPort <= 4; config.sl_nextPort++) {
        logger.info(config.baseUrlLoginSL + config.sl_nextPort + "/b1s/v2/Login")
        await fetch(config.baseUrlLoginSL + config.sl_nextPort + "/b1s/v2/Login",
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + config.auth_basic
                },
                body: raw,
                headers: { 'Content-Type': 'application/json' },
                withCredentials: true,
                xhrFields: {
                    'withCredentials': true
                }
            }
        )
            .then(async res => {
                if (res.status == 200) return res.text()
            })
            .then(result => {
                if (result !== null) {
                    const resultBody = JSON.parse(result)
                    if (!resultBody.error) {
                        Session = resultBody.SessionId
                        config.sl_realPort = config.base_url_SL + config.sl_nextPort
                        //logger.info("Port is Used: " + config.sl_realPort)
                        logger.info("Login Service Layer: (" + dbName + ") Success")
                        breakTheLoop = true
                    } else {
                        breakTheLoop = false;
                    }
                }
            })
            .catch(error => {
                logger.info("Login Service Layer Error: " + error)
            });

        if (breakTheLoop) {
            return Session;
        }
    }
}

const updateUDO_ = async (Type, Lines, DocEntry, ProcessType, PaymentMeans, BankPaymentMeans, SourcePayment, trxid, customerReffNumber, dbName, _error, paymentNo, subType) => {
    return new Promise(async (resolve, reject) => {

        var msg = "";
        let status = ""

        logger.info("Tipe dokumen: " + Type)
        if (Type == "OUT") // jika payment out
        {
            var detailsOut = []
            var row = {}
            if (subType === "OUT") {
                if (_error === "Y") {
                    row = {
                        'LineId': Lines,
                        'U_STATUS': 'Failed',
                        'U_TRXID_SAP': trxid,
                        'U_PYMOUT_STATUS': 'H2H'
                    }
                    msg = 'Failed'
                } else {
                    row = {
                        'LineId': Lines,
                        'U_STATUS': 'Success',
                        'U_TRXID_SAP': trxid,
                        'U_PYMOUT_STATUS': 'H2H'
                    }
                    msg = 'Success'
                }
                detailsOut.push(row)
            } else {
                if (_error === "Y") {
                    row = {
                        'LineId': Lines,
                        'U_STATUS': 'Failed',
                        'U_TRXID_SAP': trxid,
                        'U_PYMOUT_STATUS': paymentNo + ' - Open'
                    }
                    msg = 'Failed'
                } else {
                    row = {
                        'LineId': Lines,
                        'U_STATUS': 'Success',
                        'U_TRXID_SAP': trxid,
                        'U_PYMOUT_STATUS': paymentNo + ' - H2H'
                    }
                    msg = 'Success'
                }
                detailsOut.push(row)
            }

            

            logger.info(detailsOut)
            // update UDO
            logger.info("Details Row, Payment OUT (" + dbName + "): " + detailsOut)

            var myHeaders = new nodeFetch.Headers();
            myHeaders.append("Content-Type", "application/json");


            var requestOptions = {
                method: 'PATCH',
                headers: myHeaders,
                body: JSON.stringify({ BOS_PYM_OUT1Collection: detailsOut }),
                redirect: 'follow'
            };

            const fetchWithTimeout = (input, init, timeout) => {
                const controller = new AbortController();
                setTimeout(() => {
                    controller.abort();
                }, timeout)

                return fetch(input, { signal: controller.signal, ...init });
            }

            const wait = (timeout) =>
                new Promise((resolve) => {
                    setTimeout(() => resolve(), timeout);
                })

            const fetchWithRetry = async (input, init, timeout, retries) => {
                let increseTimeOut = config.interval_retries;
                let count = retries;

                while (count > 0) {
                    try {
                        return await fetchWithTimeout(input, init, timeout);
                    } catch (e) {
                        logger.info(e.name)
                        if (e.name !== "AbortError") throw e;
                        count--;
                        logger.error(
                            `fetch patch, retrying patch in ${increseTimeOut}s, ${count} retries left`
                        );
                        await wait(increseTimeOut)
                    }
                }
            }
            var Session = ""
            logger.info("(OUT) Mobopay - SAP  (" + dbName + "): Update Flag UDO Payment Out" + config.base_url_SL + "/b1s/v2/PYM_OUT(" + parseFloat(DocEntry) + ")")

            return fetchWithRetry(config.base_url_SL + "/b1s/v2/PYM_OUT(" + parseFloat(DocEntry) + ")", requestOptions, 60000, 3)
                .then(response => {
                    if (response.status == 204) {
                        status = response.status
                        // connection.query('UPDATE paymenth2h."BOS_TRANSACTIONS" SET "FLAGUDO" = \'1\' WHERE "REFERENCY" = $1', [customerReffNumber], async function (error, result, fields) {
                        //     if (error) {
                        //         logger.error(error)
                        //     }
                        // });
                        response.text()
                    } else {
                        fetchWithRetry();
                    }
                }).then(async result => {
                    resolve("Success")
                }).catch(error => logger.error("Error Update UDO (" + dbName + ") Ref: " + customerReffNumber, error));



        } else if (Type == "OUTSTATUS") // jika payment out STATUS
        {
            var details = []
            var row = {}
            if (_error === "Y") {
                row = {
                    'LineId': Lines,
                    'U_STATUS': 'Failed',
                    'U_TRXID_SAP': trxid,
                    'U_PYMOUT_STATUS': paymentNo + ' - Open'
                }
                msg = 'Failed'
            } else {
                row = {
                    'LineId': Lines,
                    'U_STATUS': 'Success',
                    'U_TRXID_SAP': trxid,
                    'U_PYMOUT_STATUS': paymentNo + ' - H2H'
                }
                msg = 'Success'
            }
            details.push(row)
            

            logger.info(details)

            // update UDO
            logger.info("Details Row, Payment OUT Status (" + dbName + "): " + details)


            var myHeaders = new nodeFetch.Headers();
            myHeaders.append("Content-Type", "application/json");

            // const meta = {
            //     'Content-Type': 'application/json'
            // };
            // const headers = new nodeFetch.Headers(meta);

            var requestOptions = {
                method: 'PATCH',
                headers: myHeaders,
                body: JSON.stringify({ BOS_PYMOUT_STATUS1Collection: details }),
                redirect: 'follow'
            };

            // const response = await fetch(config.base_url_SL + "/b1s/v2/PYMOUT_STATUS(" + parseFloat(DocEntry) + ")", {
            //     method: 'PATCH',
            //     body: JSON.stringify({ BOS_PYMOUT_STATUS1Collection: details }),
            //     headers: { 'Content-Type': 'application/json' }
            // });
            // const data = await response.text();
            // console.log(data)


            const fetchWithTimeout = (input, init, timeout) => {
                const controller = new AbortController();
                setTimeout(() => {
                    controller.abort();
                }, timeout)

                return fetch(input, { signal: controller.signal, ...init });
            }

            const wait = (timeout) =>
                new Promise((resolve) => {
                    setTimeout(() => resolve(), timeout);
                })

            const fetchWithRetry = async (input, init, timeout, retries) => {
                let increseTimeOut = config.interval_retries;
                let count = retries;

                while (count > 0) {
                    try {
                        return await fetchWithTimeout(input, init, timeout);
                    } catch (e) {
                        logger.info(e.name)
                        if (e.name !== "AbortError") throw e;
                        count--;
                        logger.error(
                            `fetch patch, retrying patch in ${increseTimeOut}s, ${count} retries left`
                        );
                        await wait(increseTimeOut)
                    }
                }
            }

            var errorResponse = false;
            logger.debug(requestOptions)
            logger.info("(OUT) Mobopay - SAP  (" + dbName + "): Update Flag UDO Payment Out Status " + config.base_url_SL + "/b1s/v2/PYMOUT_STATUS(" + parseFloat(DocEntry) + ")")
            return fetchWithRetry(config.base_url_SL + "/b1s/v2/PYMOUT_STATUS(" + parseFloat(DocEntry) + ")", requestOptions, 60000, config.max_retries)
                .then(response => {
                    if (response.status == 204) {
                        status = response.status
                        response.text()
                    } else {
                        errorResponse = true;
                        fetchWithRetry();
                    }
                }).then(result => {
                    resolve("Success")
                }).catch(error => logger.error("Error Update UDO (" + dbName + ") Ref: " + customerReffNumber, error));
            //getStatus(dbName, parseFloat(DocEntry), Lines, Type, msg, customerReffNumber)
        }
    });
}

function signature(message) {
    let _signature
    var Response_ = generateMessageBodySignature(message, privateKey)
    timeout = true;
    _signature = Response_

    return _signature
}

function generateMessageBodySignature(message, privateKey) {
    try {
        const sign = crypto.createSign('RSA-SHA1');
        sign.update(message);
        sign.end();
        const signature = sign.sign(privateKey);
        return signature.toString('base64')
    } catch (error) {
        logger.error(error);
    }
}


const getToken = (base64Key) => {
    return new Promise((resolve, reject) => {
        let stringToken
        var myHeaders = new nodeFetch.Headers();
        myHeaders.append("Authorization", "Basic " + base64Key);

        var urlencoded = new URLSearchParams();

        var requestOptions = {
            method: 'POST',
            headers: myHeaders,
            body: urlencoded,
            redirect: 'follow'
        };

        fetch(config.base_url_mobopay + "/token?grant_type=client_credentials", requestOptions)
            .then(response => response.text())
            .then(result => {
                const resultToken = JSON.parse(result)
                stringToken = resultToken.access_token
                resolve(resultToken.access_token)
            }).catch(error => logger.info('error', error));
    });
};

const getCountFail = async (Entry, dbName) => {
    return new Promise((resolve, reject) => {
        logger.info(config.base_url_xsjs + "/PaymentService/getCountFail.xsjs?Entry=" + Entry + "&dbName=" + dbName)
        fetch(config.base_url_xsjs + "/PaymentService/getCountFail.xsjs?Entry=" + Entry + "&dbName=" + dbName, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic U1lTVEVNOlBuQyRnUlBAMjAxOA==',
                'Cookie': 'sapxslb=0F2F5CCBA8D5854A9C26CB7CAD284FD1; xsSecureId1E75392804D765CC05AC285536FA9A62=14C4F843E2445E48A692A2D219C5C748'
            },
            'maxRedirects': 20
        })
            .then(res => res.json())
            .then(data => {
                Object.keys(data.FAIL).forEach(async function (key) {
                    if (parseFloat(data.FAIL[key].CountFail) == 0) {

                        var myHeaders = new nodeFetch.Headers();
                        myHeaders.append("Content-Type", "application/json");

                        var requestOptions = {
                            method: 'PATCH',
                            headers: myHeaders,
                            body: JSON.stringify({ "U_DOCSTATUS": "C" }),
                            redirect: 'follow'
                        };

                        const fetchWithTimeout = (input, init, timeout) => {
                            const controller = new AbortController();
                            setTimeout(() => {
                                controller.abort();
                            }, timeout)

                            return fetch(input, { signal: controller.signal, ...init });
                        }

                        const wait = (timeout) =>
                            new Promise((resolve) => {
                                setTimeout(() => resolve(), timeout);
                            })

                        const fetchWithRetry = async (input, init, timeout, retries) => {
                            let increseTimeOut = config.interval_retries;
                            let count = retries;

                            while (count > 0) {
                                try {
                                    return await fetchWithTimeout(input, init, timeout);
                                } catch (e) {
                                    logger.error(e.name)
                                    if (e.name !== "AbortError") throw e;
                                    count--;
                                    console.warn(
                                        `fetch Login, retrying login in ${increseTimeOut}s, ${count} retries left`
                                    );
                                    await wait(increseTimeOut)
                                }
                            }
                        }
                        var Session = ""
                        return fetchWithRetry(config.base_url_SL + "/b1s/v2/PYMOUT_STATUS(" + parseFloat(Entry) + ")", requestOptions, 60000, config.max_retries)
                            .then(response => {
                                if (response.status == 204) {
                                    response.text()
                                } else {
                                    fetchWithRetry();
                                }
                            })
                            .then(result => {
                                resolve("Success")
                            })
                            .catch(error => logger.error('error', error));
                    }else{
                        resolve("Success")
                    }

                    
                })
            })
            .catch(err => {
                logger.error("Get Error Update Status Header: " + err.message)
            });
    });
};