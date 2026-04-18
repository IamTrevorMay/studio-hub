// One-time script to get a Google OAuth2 refresh token for Drive uploads.
// Run: node get-google-token.js
// Then paste the refresh token into your .env as GOOGLE_OAUTH_REFRESH_TOKEN

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
});

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback...\n');

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/callback' && parsed.query.code) {
    try {
      const { tokens } = await oauth2Client.getToken(parsed.query.code);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Done! You can close this tab.</h1>');
      console.log('=== Your refresh token ===');
      console.log(tokens.refresh_token);
      console.log('\nPaste this into api/.env as GOOGLE_OAUTH_REFRESH_TOKEN');
      server.close();
    } catch (err) {
      res.writeHead(500);
      res.end('Error: ' + err.message);
      console.error('Token exchange failed:', err.message);
    }
  }
});

server.listen(3333);
