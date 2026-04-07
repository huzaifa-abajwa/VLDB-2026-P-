const express = require("express");
const multer = require('multer');

const fileRouter = express.Router();

let storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, './uploads')
    },
    filename: function (req, file, cb) {
      let extArray = file.mimetype.split("/");
      let extension = extArray[extArray.length - 1];
      cb(null, file.fieldname + '-' + Date.now()+ '.' +extension)
    }
})

const upload = multer({ storage: storage })

fileRouter.route("/upload").post(upload.single('file'), (req, res) => {
    console.log(req.file);
    try {
        res.send({ status: "success", message: `${req.file.originalname} uploaded!` })
    } catch(err) {
        res.send({ status: "err", error: err })
    }
});

module.exports = fileRouter;
