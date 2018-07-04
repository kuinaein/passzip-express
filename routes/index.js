'use strict';

var express = require('express');
var router = express.Router();

const URLSafeBase64 = require('urlsafe-base64');
const multer = require('multer');
const { google } = require('googleapis');

const clientSecret = require('./client-secret.json').web;

const upload = multer();

function createGoogleAuth(host) {
  return new google.auth.OAuth2(clientSecret.client_id,
      clientSecret.client_secret,
      `http://${host}:${global.theApp.get('port')}/upload-files`)
}

/* GET home page. */
router.get('/', function(req, res, next) {
  const auth = createGoogleAuth(req.hostname)
  res.redirect(auth.generateAuthUrl({scope: 'https://www.googleapis.com/auth/gmail.compose'}));
});

router.get('/upload-files', function(req, res, next) {
  const code = req.query.code
  if (!code) {
    res.redirect('/')
  }
  res.render('upload-files', {
    title: 'パスワードかける君',
    code
  })
});

function b64 (s) {
  const b = s instanceof Buffer ? s : Buffer.from(s)
  return URLSafeBase64.encode(b)
}

router.post('/upload-files', upload.array('files'), function(req, res, next) {
  const fs = req.files.map(f => {
    return {
      name: f.originalname,
      body: new Buffer(f.buffer, 'base64')
    };
  });
  const auth = createGoogleAuth(req.hostname);
  const boundary = '=_Kaien315114194';
  let body = `Subject: =?UTF-8?B?${b64(req.body.subject)}?=
Content-Type: multipart/mixed; boundary="${boundary}"

--${boundary}
Conent-Type: text/plain; charset="UTF-8";
Content-Transfer-Encoding: base64

${b64('こんにちは、世界！')}\n`
  for (const f of req.files) {
    // Content-Type: ${f.mimetype}; name="=?UTF-8?B?${b64(f.originalname)}?="
    body += `--${boundary}
Content-Type: ${f.mimetype}; name="=?UTF-8?B?${f.originalname}?="
Content-Transfer-Encoding: base64

${f.buffer.toString('base64')}\n`
  }
  body += `--${boundary}--\n`;

  const b64ed = b64(body);
  auth.getToken(req.body.code).then(r => {
    const gmail = google.gmail({version: 'v1', auth})
    auth.credentials = r.tokens
    return gmail.users.drafts.create({
      userId: 'me',
      resource: { message: { raw: b64ed } }
    });
  }).then(r => {
    res.set('Content-Type', 'text/plain');
    res.send('OK\n\n' + JSON.stringify(r.data));
  }).catch(err => {
    console.log(err)
    res.send('エラー！: ' + err)
  })
});

module.exports = router;
