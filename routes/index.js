'use strict';

const path = require('path');
const crypto = require('crypto');

const express = require('express');
const router = express.Router();

const URLSafeBase64 = require('urlsafe-base64');
const multer = require('multer');
const { google } = require('googleapis');
const Minizip = require('minizip-asm.js');

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

// 12バイト(=48ビット)のデータをbase64エンコードすると16文字になる
// 6ビットのデータをbase64エンコードすると1文字(8ビット)になるので
function generatePassword () {
  return new Promise((resolve, reject) => {
    try {
      resolve(Buffer.from(crypto.randomBytes(12)).toString('base64'));
    } catch(err) {
      reject(err);
    }
  })
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
