'use strict';

const path = require('path');

const express = require('express');
const router = express.Router();

const URLSafeBase64 = require('urlsafe-base64');
const multer = require('multer');
const { google } = require('googleapis');
const Minizip = require('minizip-asm.js');
const randomNumber = require("random-number-csprng");

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

function generatePassword () {
  return _generatePassword8('').then(pw => {
    return _generatePassword8(pw);
  });
}

// 6バイトのデータをbase64エンコードすると8バイトになる
// 6ビットのデータをbase64エンコードすると8ビット(1文字)になるので
const PWD_BLOCK_MAX = Math.pow(8, 6) - 1;
function _generatePassword8 (s) {
  // Math.pow(64, 6) < Number.MAX_SAFE_INTEGER
  return randomNumber(0, PWD_BLOCK_MAX).then(n => {
    const ar = [];
    for (let i = 0; i < 6; ++i) {
      ar.push(n % 8);
      n = Math.floor(n / 8);
    }
    return s + Buffer.from(ar).toString('base64');
  });
}

router.post('/upload-files', upload.array('files'), function(req, res, next) {
  const result = {};
  const auth = createGoogleAuth(req.hostname);
  const gmail = google.gmail({version: 'v1', auth})
  let b64ed;
  let b64ed2;
  generatePassword().then(password => {
    const mz = new Minizip();
    for (const f of req.files) {
      mz.append(f.originalname, f.buffer, { password })
    }
    const attachmentName = (req.body.fname ||
        path.basename(req.files[0].originalname,
          path.extname(req.files[0].originalname))) + '.zip';

    const boundary = '=_Kaien315114194';
    let buf = Buffer.from(`Subject: =?UTF-8?B?${b64(req.body.subject)}?=
Content-Type: multipart/mixed; boundary="${boundary}"

--${boundary}
Conent-Type: text/plain; charset="UTF-8";
Content-Transfer-Encoding: base64

パスワードは別メールでお送りいたします。
--${boundary}
Content-Type: application/zip; name="=?UTF-8?B?${attachmentName}?="
Content-Transfer-Encoding: base64\n\n`);
    buf = Buffer.concat([
      buf,
      Buffer.from(mz.zip().toString('base64')),
      Buffer.from(`--${boundary}--\n`)
    ]);

    b64ed = b64(buf);
    b64ed2 = b64(`Subject: =?UTF-8?B?${b64('【PW】' + req.body.subject)}?=

別メールにて送信した添付ファイルのパスワードは
「${password}」
になります。
`);

    return auth.getToken(req.body.code);
  }).then(r => {
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
