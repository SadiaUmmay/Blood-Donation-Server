const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express');
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 5000
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const crypto = require('crypto')
const { ObjectId } = require('mongodb');


const app = express();
app.use(cors());
app.use(express.json())

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorize access' })
  }

  try {
    const idToken = token.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(idToken)
    console.log("decoded info", decoded)
    req.decoded_email = decoded.email;
    next();
  }
  catch (error) {
    return res.status(401).send({ message: 'unauthorize access' })
  }
}



const uri = `mongodb+srv://${process.env.DB_HOST}:${process.env.DB_PASS}@cluster0.yfrfj.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const database = client.db('blood')
    const userCollection = database.collection("user")
    const requestCollection = database.collection('requests')
    const paymentCollection = database.collection('payments')
    const donationRequestCollection = database.collection("donationRequests");


    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      userInfo.createdAt = new Date();
      userInfo.role = 'donor'
      userInfo.status = 'active'
      const result = await userCollection.insertOne(userInfo);
      res.send(result)
    });

    app.get('/users', verifyFBToken, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.status(200).send(result)
    })

    app.get('/users/role/:email', async (req, res) => {
      const { email } = req.params

      const query = { email: email }
      const result = await userCollection.findOne(query)
      console.log(result)
      res.send(result)
    })
    app.patch('/update/user/status', verifyFBToken, async (req, res) => {
      const { email, status } = req.query;
      const query = { email: email };
      const updateStatus = {
        $set: {
          status: status
        }
      }
      const result = await userCollection.updateOne(query, updateStatus)
      res.send(result)
    })
    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      res.send(result);
    });

    // volunteer 
    app.patch('/users/make-volunteer/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email;


      const adminUser = await userCollection.findOne({ email: req.decoded_email });

      if (adminUser?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' });
      }

      const result = await userCollection.updateOne(
        { email },
        { $set: { role: 'volunteer' } }
      );

      res.send(result);
    });

    // admin 
    app.patch('/users/make-admin/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email;

      const adminUser = await userCollection.findOne({
        email: req.decoded_email
      });

      if (adminUser?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' });
      }

      const result = await userCollection.updateOne(
        { email },
        { $set: { role: 'admin' } }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ message: 'User not found' });
      }

      res.send(result);
    });


    // Admin stats API
    app.get("/admin-stats", async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments({ role: "donor" });
        const totalRequests = await requestCollection.countDocuments();
        const payments = await paymentCollection.find().toArray();
        const totalFunds = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

        res.send({ totalUsers, totalRequests, totalFunds });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch stats" });
      }
    });


    // request 

    app.post('/requests', verifyFBToken, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestCollection.insertOne(data)
      res.send(result)
    })

    app.get('/donationrequest', verifyFBToken, async (req, res) => {
      const email = req.decoded_email
      const size = Number(req.query.size);
      const page = Number(req.query.page);

      const query = { requesterEmail: email };

      const result = await requestCollection
        .find(query)
        .limit(size)
        .skip(size * page)
        .toArray();

      const totalRequest = await requestCollection.countDocuments(query);

      res.send({ request: result, totalRequest })
    })

    // all request 
    app.get('/all-blood-donation-request', verifyFBToken, async (req, res) => {

      const adminUser = await userCollection.findOne({
        email: req.decoded_email
      });

      if (!['admin', 'volunteer'].includes(adminUser?.role)) {
        return res.status(403).send({ message: 'Forbidden' });
      }


      const result = await requestCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    // Public pending donation requests
    app.get('/donation-requests', async (req, res) => {
      try {
        const requests = await requestCollection
          .find({ donationStatus: 'pending' })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(requests);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to fetch requests' });
      }
    });

    // donation status pending => inprogress

    app.patch("/requests/status/:id", verifyFBToken, async (req, res) => {
      const { status } = req.body;
    
      const result = await requestCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { donationStatus: status } }
      );
    
      res.send(result);
    });
    

    //donation details

    app.get("/donation-requests/:id", async (req, res) => {
      const { id } = req.params;

      const request = await requestCollection.findOne({
        _id: ObjectId.isValid(id) ? new ObjectId(id) : id
      });

      res.send(request);


    });


    // donation status control
    app.patch("/requests/status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body; // 👈 status নাও

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { donationStatus: status }
      };

      const result = await requestCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // request delete 
    app.delete("/requests/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.decoded_email;


        const query = { _id: new ObjectId(id), requesterEmail: email };
        const result = await requestCollection.deleteOne(query);

        if (result.deletedCount === 1) {
          res.send({ message: "Deleted successfully" });
        } else {
          res.status(403).send({ message: "Not authorized or request not found" });
        }
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // update donation 
    const { ObjectId } = require("mongodb");

    // Update donation request by ID
    app.patch("/requests/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      try {
        const result = await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
      }
    });


    // search 

    app.get('/search', async (req, res) => {
      const { bloodGroup, district, upozilla } = req.query;

      const query = {};

      if (!query) {
        return;
      }
      if (bloodGroup) {
        const fixed = bloodGroup.replace(/ /g, "+").trim();
        query.bloodGroup = fixed;

      }
      if (district) {
        query.recipientDistrict = district;
      }
      if (upozilla) {
        query.recipientUpozilla = upozilla;
      }
      const result = await requestCollection.find(query).toArray();
      res.send(result)
    })
    // fund?
    app.get("/payments", verifyFBToken, async (req, res) => {
      try {
        const payments = await paymentCollection.find().sort({ paidAt: -1 }).toArray();
        res.send(payments);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch payments" });
      }
    });


    // payments 

    app.post('/create-payment-checkout', async (req, res) => {
      const information = req.body;
      const amount = parseInt(information.fundAmount) * 100;


      const session = await stripe.checkout.sessions.create({

        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: 'please donate'
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          fundName: information?.fundName
        },
        customer_email: information.fundEmail,
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`
      });

      res.send({ url: session.url })

    })


    app.post('/success-payment', async (req, res) => {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(session_id);
      console.log(session)

      const transactionId = session.payment_intent;

      const isPaymentExist = await paymentCollection.findOne({ transactionId })

      if (isPaymentExist) {
        return
      }

      if (session.payment_status == 'paid') {
        const paymentInfo = {
          amount: session.amount_total / 100,
          currency: session.currency,
          fundEmail: session.customer_email,
          payment_status: session.payment_status,
          paidAt: new Date()
        }

        const result = await paymentCollection.insertOne(paymentInfo)
        return res.send(result)
      }
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send("hello, Blood Donation Server")
})
app.listen(port, () => {
  console.log(`server is running on ${port}`);
})