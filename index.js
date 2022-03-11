import express from 'express';
import pg from 'pg';
import fs from 'fs';
import fastcsv from 'fast-csv';
import methodOverride from 'method-override';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { sessionAuth } from './hashing.js';
import {
  signUpForm, signUpFormResults, loginForm, loginFormResults, logout,
} from './account-route-callbacks.js';

const { Pool } = pg;

let pgConnectionConfigs;
if (process.env.ENV === 'DATABASE_URL') {
  // determine how we connect to the remote Postgres server
  pgConnectionConfigs = {
    user: 'postgres',
    // set DB_PASSWORD as an environment variable for security.
    password: process.env.DB_PASSWORD,
    host: 'localhost',
    database: 'p65',
    port: 5432,
  };
} else {
  // determine how we connect to the local Postgres server
  pgConnectionConfigs = {
    user: 'neo',
    host: 'localhost',
    database: 'p65',
    port: 5432,
  };
}

const pool = new Pool(pgConnectionConfigs);
const app = express();

// set the name of the upload directory here
const multerUpload = multer({ dest: 'uploads/' });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.static('uploads'));
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(sessionAuth);

// renders login page with OTP
app.get('/', (req, res) => {
  res.render('login');
});

// #################### Helper Functions ####################

// Return a promise to an invoice
function getInvoiceById(id) {
  const query = `SELECT
      invoices.delivery_number,
      items.species,
      invoices.status,
      invoices.mode_delivery,
      invoices.pmt_date,
      invoices.delivery_date,
      items.size,
      items.qual,
      items.weight,
      items.price_kg,
      items.price_total,
      customers.cust_name,
      customers.cust_contact
    FROM invoices
        JOIN items USING (delivery_number)
        JOIN customers USING (cust_code)
    WHERE invoices.delivery_number = '${id}'`;
  return pool.query(query);
}

function getItemsSum(id) {
  const query = `SELECT sum(price_total) as tot_invoice
    FROM items 
    WHERE delivery_number = '${id}'`;
  return pool.query(query);
}

function getPendingInvoices() {
  // query for list of invoiceId which are pending
  const query = `SELECT
       invoices.delivery_number
FROM invoices
WHERE status = 'Pending'`;
  return pool.query(query);
}

function getInvoiceAndSum(invoiceId) {
  return Promise.all([
    getInvoiceById(invoiceId),
    getItemsSum(invoiceId),
  ]);
}

// #################### App Routes ####################

// displays single invoice
app.get('/invoice/:id', (req, res) => {
  if (req.isUserLoggedIn === false) {
    res.redirect('/login');
  } else {
    const invoiceId = req.params.id;

    return Promise.all([
      getInvoiceById(invoiceId),
      getItemsSum(invoiceId),
    ])
      .then((results) => {
        const [invoice, invoiceSum] = results;
        const singleInvoice = invoice.rows;
        const invoiceTotal = invoiceSum.rows[0];
        console.log(invoiceTotal);
        const invoiceID = invoice.rows[0].delivery_number;
        res.render('single-invoice', { singleInvoice, invoiceTotal, invoiceID });
      });
  }
});

// renders delivery tracking page
app.get('/delivery', (req, res) => {
  if (req.isUserLoggedIn === false) {
    res.redirect('/login');
  } else {
    const deliveryQuery = `SELECT
       invoices.delivery_number,
       invoices.status,
       invoices.mode_delivery,
       invoices.pmt_date,
       invoices.delivery_date,
       customers.cust_name,
       customers.cust_contact
    FROM invoices
    JOIN customers USING (cust_code)`;

    pool.query(deliveryQuery).then((deliveryQueryResult) => {
      const deliveryNotes = deliveryQueryResult.rows;
      res.render('delivery-page', { deliveryNotes });
    });
  }
});

// render edit page with details filled
app.get('/invoice/:id/edit', (req, res) => {
  if (req.isUserLoggedIn === false) {
    res.redirect('/login');
  } else {
    const invoiceId = req.params.id;
    const editQuery = `SELECT
       invoices.delivery_number,
       items.species,
       invoices.status,
       invoices.mode_delivery,
       invoices.pmt_date,
       invoices.delivery_date,
       items.size,
       items.qual,
       items.weight,
       items.price_kg,
       items.price_total,
       customers.cust_name,
       customers.cust_contact
FROM invoices
    JOIN items USING (delivery_number)
    JOIN customers USING (cust_code)
WHERE invoices.delivery_number = '${invoiceId}'`;

    pool.query(editQuery).then((editQueryResult) => {
      const editFormInput = editQueryResult.rows;
      const invoiceID = editFormInput[0].delivery_number;
      res.render('edit-invoice', { editFormInput, invoiceID });
    });
  }
});

// update invoice field in database
app.put('/invoice/:id/edit', (req, res) => {
  if (req.isUserLoggedIn === false) {
    res.redirect('/login');
  } else {
    const invoiceId = req.params.id;

    const editEntryQuery = `UPDATE invoices 
  SET delivery_date = '${req.body.delivery_date}', 
  mode_delivery = '${req.body.mode_delivery}' 
  WHERE delivery_number = '${invoiceId}' 
  RETURNING *`;

    pool.query(editEntryQuery, (editEntryQueryError, editEntryQueryResult) => {
      if (editEntryQueryError) {
        console.log('error', editEntryQueryError);
      } else {
        console.log(editEntryQueryResult.rows);
        res.redirect('/delivery');
      }
    });
  }
});

// for admin: delete invoice
app.delete('/invoice/:id/delete', (req, res) => {
  if (req.isUserLoggedIn === false) {
    res.redirect('/login');
  } else {
    const invoiceId = req.params.id;
    pool.query('DELETE FROM invoices WHERE delivery_number = $1', [invoiceId]).then((deleteResult) => {
      res.redirect('/admin-page1');
    });
  }
});

// renders admin page1
app.get('/admin-page1', (req, res) => getPendingInvoices()
  // eslint-disable-next-line max-len
  .then((pendingInvoices) => Promise.all(pendingInvoices.rows.map((invoice) => getInvoiceAndSum(invoice.delivery_number))))
  .then((results) => {
    const invoices = results.map((result) => {
      const [pendingInvoices, invoiceSum] = result;
      const invoiceList = pendingInvoices.rows;
      console.log(invoiceList);
      const invoiceTotal = invoiceSum.rows;
      console.log(invoiceTotal);
      return { invoiceList, invoiceTotal };
    });
    console.table(invoices);
    console.table(invoices[2]);
    console.table(invoices[3]);
    res.render('admin-page1', { invoices });
  }));

// renders admin page2
app.get('/admin-page2', (req, res) => {
  if (req.isUserLoggedIn === false) {
    res.redirect('/login');
  } else {
    res.render('admin-page2');
  }
});

// post data from admin page2
app.post('/admin-page2', multerUpload.single('file'), (req, res) => {
  console.log('request came in');
  console.log(req.file.filename);
  const fileID = req.file.filename;
  const stream = fs.createReadStream(`uploads/${fileID}`);
  const csvData = [];
  const csvStream = fastcsv
    .parse()
    .on('data', (data) => {
      csvData.push(data);
    })
    .on('end', () => {
    // remove the first line: header
      csvData.shift();
      const query = `INSERT INTO auction_list (
                           id,
                           vessel_name,
                           species,
                           size,
                           qual,
                           weight,
                           box_size,
                           price_box,
                           created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

      pool.connect((err, client, done) => {
        if (err) throw err;
        try {
          csvData.forEach((row) => {
            client.query(query, row, (err, res) => {
              if (err) {
                console.log(err.stack);
              } else {
                console.log(`inserted ${res.rowCount} row:`, row);
              }
            });
          });
        } finally {
          done();
        }
      });
    });
  stream.pipe(csvStream);

  res.redirect('/admin-page3');
});

// renders admin page3
app.get('/admin-page3', (req, res) => {
  if (req.isUserLoggedIn === false) {
    res.redirect('/login');
  } else {
    const auctionQuery = 'SELECT * FROM auction_list';

    pool.query(auctionQuery).then((auctionQueryResult) => {
      const auctionList = auctionQueryResult.rows;
      const sortQuery = req.query.sorter;

      if (sortQuery === 'species') {
        auctionList.sort((a, b) => ((a.species > b.species) ? 1 : -1));
      }

      if (sortQuery === 'size') {
        auctionList.sort((a, b) => ((a.size > b.size) ? 1 : -1));
      }

      if (sortQuery === 'qual') {
        auctionList.sort((a, b) => ((a.qual > b.qual) ? 1 : -1));
      }

      if (sortQuery === 'vessel_name') {
        auctionList.sort((a, b) => ((a.vessel_name > b.vessel_name) ? 1 : -1));
      }

      res.render('admin-page3', { auctionList });
    });
  }
});

// renders admin page2
app.get('/invalid', (req, res) => {
  res.render('invalid');
});

// #################### Auth Routes ####################
// Signup
app.get('/signup', signUpForm);
app.post('/signup', signUpFormResults);
// Login
app.get('/login', loginForm);
app.post('/login', loginFormResults);
// Logout
app.get('/logout', logout);

app.listen(3005);
