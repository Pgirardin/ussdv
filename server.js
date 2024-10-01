const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const xml2js = require('xml2js');
const axios = require('axios');

const app = express();
app.use(bodyParser.text({ type: 'application/xml' }));

// Database setup
const db = new sqlite3.Database('ussd.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create table if not exists
        db.run(`
            CREATE TABLE IF NOT EXISTS ussd_logs (
                msisdn TEXT,
                sessionid TEXT,
                transactionid TEXT,
                ussdgw_id TEXT,
                requestType TEXT,
                responseType TEXT,
                responseMessage TEXT,
                userMessage TEXT,
                timestamp TEXT
            )
        `);
    }
});

// Lumitel service configuration
const lumitel_url = "http://10.225.6.120:9136";
const user = "ussd";
const pass = "ussd";

// Route to handle incoming requests
app.post('/', (req, res) => {
    const postdata = req.body;

    // Log raw XML for debugging purposes
    console.log('Raw XML received:', postdata);

    // Clean and process incoming XML
    xml2js.parseString(postdata, { explicitArray: false, tagNameProcessors: [xml2js.processors.stripPrefix] }, (err, result) => {
        if (err) {
            console.error('Error parsing XML:', err);
            sendImmediateResponse(res, 1); // Send immediate failure response
            return;
        }

        try {
            // Extract relevant data from the parsed XML
            const insertMO = result.Envelope?.Body?.InsertMO || result.Envelope?.Body?.insertmo;
            if (!insertMO) {
                throw new Error("Missing InsertMO in the request");
            }

            const requestType = insertMO.requesttype || null;
            const msisdn = insertMO.msisdn || '';
            const sessionid = insertMO.sessionid || '';
            const transactionid = insertMO.transactionid || '';
            const ussdgw_id = insertMO.ussdgw_id || '';

            if (!requestType || !msisdn || !sessionid || !transactionid || !ussdgw_id) {
                sendImmediateResponse(res, 1); // Send immediate failure response
                return;
            }

            let responseType = '103'; // General error
            let responseMessage = 'Invalid request. Please try again.';

            // Handle request based on requestType
            switch (requestType) {
                case '100':
                    responseType = '202';
                    responseMessage = "Welcome to eCommerce";
                    break;
                case '101':
                    switch (insertMO.msg) {
                        case '1':
                            responseType = '202';
                            responseMessage = "Please enter your 4-digit PIN to create your account.";
                            break;
                        case '2':
                            responseType = '202';
                            responseMessage = "Log in process initiated.";
                            break;
                        default:
                            responseType = '104';
                            responseMessage = "Invalid input. Please try again.";
                            break;
                    }
                    break;
                case '201':
                    responseType = '201';
                    responseMessage = "Thank you for using our service!";
                    break;
                case '204':
                    responseType = '204';
                    responseMessage = "Invalid request.";
                    break;
                default:
                    responseType = '104';
                    responseMessage = "General error, please try again.";
            }

            // Send immediate success response
            sendImmediateResponse(res, 0);

            // Store request and response in the database
            const timestamp = new Date().toISOString();
            const query = `INSERT INTO ussd_logs (msisdn, sessionid, transactionid, ussdgw_id, requestType, responseType, responseMessage, userMessage, timestamp)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            db.run(query, [msisdn, sessionid, transactionid, ussdgw_id, requestType, responseType, responseMessage, insertMO.msg || '', timestamp], (err) => {
                if (err) {
                    console.error('Database error:', err);
                }
            });

            // Delay and call Lumitel service
            setTimeout(() => {
                callLumitelService(responseMessage, msisdn, sessionid, transactionid, ussdgw_id, responseType);
            }, 2000);

        } catch (error) {
            console.error('Error processing request:', error);
            sendImmediateResponse(res, 1); // Send immediate failure response
        }
    });
});

// Helper function to send immediate responses
function sendImmediateResponse(res, errorCode) {
    const responseXml = `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns2="http://ws.ussd/">
            <soapenv:Header/>
            <soapenv:Body>
                <ns2:InsertMOResponse>
                    <return>
                        <errorCode>${errorCode}</errorCode>
                    </return>
                </ns2:InsertMOResponse>
            </soapenv:Body>
        </soapenv:Envelope>`;

    res.set('Content-Type', 'application/xml');
    res.send(responseXml);
}

// Helper function to call the Lumitel service
function callLumitelService(responseMessage, msisdn, sessionid, transactionid, ussdgw_id, responseType) {
    const lumitelXml = `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://ws.ussd/">
            <soapenv:Header/>
            <soapenv:Body>
                <ws:InsertMO>
                    <InsertMO>
                        <msg>${responseMessage}</msg>
                        <msisdn>${msisdn}</msisdn>
                        <pass>${pass}</pass>
                        <requestType>${responseType}</requestType>
                        <sessionid>${sessionid}</sessionid>
                        <transactionid>${transactionid}</transactionid>
                        <user>${user}</user>
                        <ussdgw_id>${ussdgw_id}</ussdgw_id>
                    </InsertMO>
                </ws:InsertMO>
            </soapenv:Body>
        </soapenv:Envelope>`;

    axios.post(lumitel_url, lumitelXml, { headers: { 'Content-Type': 'application/xml' } })
        .then(response => {
            console.log('Lumitel Response:', response.data);
        })
        .catch(error => {
            console.error('Error calling Lumitel service:', error);
        });
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
