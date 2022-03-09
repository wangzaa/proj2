import pg from 'pg';
import { getHash } from './hashing.js';

const { Pool } = pg;

let pgConnectionConfigs;
if (process.env.DATABASE_URL) {
  // pg will take in the entire value and use it to connect
  pgConnectionConfigs = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  };
} else {
  pgConnectionConfigs = {
    user: 'neo',
    host: 'localhost',
    database: 'p65',
    port: 5432,
  };
}

const pool = new Pool(pgConnectionConfigs);

// Sign up
export const signUpForm = (req, res) => {
  res.render('signup');
};

export const signUpFormResults = (req, res) => {
  const { email } = req.body;
  const { password } = req.body;
  const hashedPassword = getHash(password);
  const inputData = [email, hashedPassword];
  const sqlQuery = 'INSERT INTO users (email, password) VALUES ($1, $2)';
  pool.query(sqlQuery, inputData).then((result) => {
    console.log('user details added!');
    res.redirect('/');
  });
};

// Login
export const loginForm = (req, res) => {
  res.render('login');
};

export const loginFormResults = (req, res) => {
  const enteredEmail = [req.body.email];
  const enteredPassword = req.body.password;

  const sqlQuery = 'SELECT * FROM users WHERE email = $1';
  pool.query(sqlQuery, enteredEmail).then((result) => {
    if (result.rows.length === 0) {
      res.redirect('/invalid');
      return;
    }

    const hashedPassword = getHash(enteredPassword);

    if (result.rows[0].password === hashedPassword) {
      const hashedCookieString = getHash(enteredEmail[0]);
      res.cookie('loggedInHash', hashedCookieString);
      res.cookie('userId', enteredEmail[0]);
      res.redirect('/');
    } else {
      // res.send('Sorry! Please try again!').status(403);
      res.redirect('/invalid');
    }
  });
};

// Logout
export const logout = (req, res) => {
  res.clearCookie('loggedInHash');
  res.clearCookie('userId');
  res.redirect('/login');
};
