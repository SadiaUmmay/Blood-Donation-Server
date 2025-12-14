const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express');
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 5000

const app = express();
app.use(cors());
app.use(express.json())

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const verifyFBToken = async (req, res, next)=>{
  const token = req.headers.authorization;

  if(!token){
    return res.status(401).send({message: 'unauthorize access'})
  }

  try{
    const idToken = token.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(idToken)
    console.log("decoded info", decoded)
    req.decoded_email = decoded.email;
    next();
  }
  catch(error){
    return res.status(401).send({message: 'unauthorize access'})
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
  

    
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      userInfo.createdAt = new Date();
      userInfo.role = 'donor'
      userInfo.status= 'active'
      const result = await userCollection.insertOne(userInfo);
     
      res.send(result)
    });

    app.get('/users/role/:email', async (req, res)=>{
      const {email} = req.params

      const query = {email: email}
      const result = await userCollection.findOne(query)
      console.log(result)
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

    // request 

    app.post('/requests', verifyFBToken,  async(req,res)=>{
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestCollection.insertOne(data)
      res.send(result)
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

app.get('/', (req,res)=>{
    res.send("hello, Blood Donation Server")
})
app.listen(port,()=>{
    console.log(`server is running on ${port}`);
})