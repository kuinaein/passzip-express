'use strict';

const path = require('path');

const express = require('express');
const router = express.Router();

const URLSafeBase64 = require('urlsafe-base64');
const multer = require('multer');
const { google } = require('googleapis');
const Minizip = require('minizip-asm.js');
const MersenneTwister = require('mersenne-twister');

const clientSecret = require('./client-secret.json').web;
const ALNUM = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

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
  const generator = new MersenneTwister();
  let password = '';
  for (let i = 0; i < 13; ++i) {
    // 出力値は[0,1) の半開区間であるはずだが念の為minをかます
    password += ALNUM.charAt(Math.min(ALNUM.length - 1,
      Math.floor(generator.random() * ALNUM.length)));
  }

  const mz = new Minizip();
  for (const f of req.files) {
    mz.append(f.originalname, f.buffer, { password })
  }
  const attachmentName = (req.body.fname ||
      path.basename(req.files[0].originalname,
        path.extname(req.files[0].originalname))) + '.zip';

  const boundary = '=_Kaien315114194';
  let body = `Subject: =?UTF-8?B?${b64(req.body.subject)}?=
Content-Type: multipart/mixed; boundary="${boundary}"

--${boundary}
Conent-Type: text/plain; charset="UTF-8";
Content-Transfer-Encoding: base64

パスワードは別メールでお送りいたします。\n`;

  body += `--${boundary}
Content-Type: application/zip; name="=?UTF-8?B?${attachmentName}?="
Content-Transfer-Encoding: base64

${mz.zip().toString('base64')}
--${boundary}--\n`;

  const b64ed = b64(body);
  const b64ed2 = b64(`Subject: =?UTF-8?B?${b64('【PW】' + req.body.subject)}?=

別メールにて送信した添付ファイルのパスワードは
「${password}」
になります。
`);

  const result = {};
  const auth = createGoogleAuth(req.hostname);
  const gmail = google.gmail({version: 'v1', auth})
  auth.getToken(req.body.code).then(r => {
    auth.credentials = r.tokens
    return gmail.users.drafts.create({
      userId: 'me',
      resource: { message: { raw: b64ed } }
    });
  }).then(r => {
    result.mail1 = r.data
    return gmail.users.drafts.create({
      userId: 'me',
      resource: { message: { raw: b64ed2 } }
    });
  }).then(r => {
    result.mail2 = r.data
    res.set('Content-Type', 'text/plain');
    res.send('OK\n\n' + JSON.stringify(result, null, 2));
  }).catch(err => {
    console.log(err)
    res.send('エラー！: ' + err)
  })
});

module.exports = router;
