import {ConvertOutputsToByteArray, ConvertInputToByteArray} from './Convertors';
import Sign from './Signature';

/* global BigInt */

function GetOutputHash(outputs) {
    return new Promise((resolve, _) => crypto.subtle
        .digest('SHA-256', ConvertOutputsToByteArray(outputs))
        .then(hash => resolve(new Uint8Array(hash))));
}

function GetSigningData(input, outputHash) {
    let ans = new Uint8Array(68);
    ans.set(ConvertInputToByteArray(input));
    ans.set(outputHash, 36);
    return ans;
}

function GetPublicKeyOfAlias(index, alias) {
    return new Promise((resolve, reject) => {
        fetch("/getPublicKey", {
            method: "POST",
            body: JSON.stringify({
                alias: alias,
            }),
        })
        .then(res => {
            if(res.status!==200)
                reject("Cannot get public key for alias "+alias);
            else
                res.json().then(data => resolve({
                    index: index,
                    key: data.publicKey,
                }));
        })
        .catch(err => reject(err));
    });
}

function GetRawInputs(data){
    return new Promise((resolve, reject) => {
        let totalOutputAmount = BigInt(data.transactionFees);
        data.outputDetails.map(output => totalOutputAmount+=BigInt(output.amount));

        let inputs = [];
        let inputAmount = 0n;
        for(let i=0; i<data.unusedOutputs.length; i++){
            inputAmount += BigInt(data.unusedOutputs[i].amount);
            inputs.push(data.unusedOutputs[i]);
            if(inputAmount>=totalOutputAmount)
                break;
        }

        if(inputAmount<totalOutputAmount)
            reject("Not enough balance to make transactions.");
        
        resolve({
            inputs: inputs,
            backToSelf: inputAmount-totalOutputAmount,
        });
    });
}

export default function MakeTransactionRequestBody(data) {
    /*
    data = {
        publicKey: <PEM key>
        privateKey: <PEM key>
        unusedOutputs: [
            {
                transactionId:
                index:
                amount:
            }
        ]
        transactionFees: number
        outputDetails: [
            {
                queryMethod:
                alias:
                publicKey:
                amount:
            }
        ]
    }
    */

    /*
    return value = {
        "inputs": [
            {
                "transactionId": "<hex representation of the transaction ID of this input>",
                "index": <index of this input in the list of outputs of the transaction>,
                "signature": "<hex representation of the signature for this input>"
            },
            ...
        ],
        "outputs": [
            {
                "amount": <number of coins>,
                "recipient": "<public key of recipient>"
            },
            ...
        ]
    }
    */

    return new Promise((resolve, reject) => {
        let todo = [];
        for(let i=0; i<data.outputDetails.length; i++){
            if(data.outputDetails[i].queryMethod === "alias") {
                todo.push(GetPublicKeyOfAlias(i, data.outputDetails[i].alias));
            }
        }
        let outputs = [];
        let outputHash = null;
        let inputs = [];
        Promise.all(todo) // Fetch the publicKeys of all aliases
        .then(results => { // assign publicKeys to all output objects
            results.forEach(result => {
                data.outputDetails[result.index].publicKey = result.key;
            });
        })
        .then(_ => GetRawInputs(data))
        .then(rawInputData => {
            inputs = rawInputData.inputs;
            outputs.push({
                amount: rawInputData.backToSelf,
                recipient: data.publicKey,
            });
        })
        .then(_ => { // Create output objects in the desirable format
            data.outputDetails.forEach(output => {
                outputs.push({
                    amount: BigInt(output.amount),
                    recipient: output.publicKey,
                });
            });
            return GetOutputHash(outputs);
        })
        .then(hash => outputHash = hash) // set output hash
        .then(_ => {
            let signaturePromises = inputs.map(input => Sign(GetSigningData(input, outputHash), data.privateKey));
            return Promise.all(signaturePromises);
        })
        .then(signatures => {
            for(let i=0; i<inputs.length; i++){
                delete inputs[i].amount;
                inputs[i].signature = signatures[i];
            }
            resolve({
                inputs: inputs,
                outputs: outputs,
            });
        })
        .catch(err => reject(err));
    });
}
