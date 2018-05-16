# changesReader

The *changesReader* object allows a Cloudant databases's [changes feed](https://console.bluemix.net/docs/services/Cloudant/api/database.html#get-changes) to be consumed across multiple HTTP requests. Once started, the *changesReader* will continuously poll the server for changes, handle network errors & retries and feed you with database changes as and when they arrive. The *changesReader* library has two modes of operation:

1. `changesReader.start()` - to listen to changes indefinitely.
2. `changesReader.get()` - to listen to changes until the end of the changes feed is reached.

The `changesReader` library hides the myriad of options that the Cloudant changes API offers and exposes only the features you need to build a resilient, resumable change listener.

## Listening to a changes feed indefinitely

Every Cloudant database object has a *changesReader* object ready to use. Simply call its `start` method to monitor the changes feed indefinitely:

```js
const Cloudant = require('@cloudant/cloudant');
const cloudant = Cloudant({ account: 'myaccount', password: 'password'});
const db = cloudant.db.use('mydatabase');
const cr = db.changesReader.start();
```

The object returned from `changesReader.start()` emits events when a change occurs:

```js
cr.on('change', (c) => {
  console.log('change', c);
}).on('batch', (b) => {
  console.log('a batch of', b.length, 'changes has arrived');
}).on('seq', (s) => {
  console.log('sequence token', s);
}).on('error', (e) => {
  console.error('error', e);
});
```

Note: you probably want to monitor *either* the `change` or `batch` event, not both.

## Listening to the changes feed until you have caught up

Alternatively the `changesReader.get()` method is available to monitor the changes feed until there are no more changes to consume, at which point an `end` event is emitted.

```js
const cr = db.changesReader.get();
cr.on('change', (c) => {
  console.log('change', c);
}).on('batch', (b) => {
  console.log('a batch of', b.length, 'changes has arrived');
}).on('seq', (s) => {
  console.log('sequence token', s);
}).on('error', (e) => {
  console.error('error', e);
}).on('end', () => {
  console.log('changes feed monitoring has stopped');
});
```

## Options

| Parameter | Description                                                                                                                                                                             | Default value | e.g.                            |   |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|---------------------------------|---|
| batchSize | The maximum number of changes to ask Cloudant for per HTTP request. This is the maximum number of changes you will receive in a `batch` event. | 100           | 500                             |   |
| since     | The position in the changes feed to start from where `0` means the beginning of time, `now` means the current position or a string token indicates a fixed position in the changes feed | now           | 390768-g1AAAAGveJzLYWBgYMlgTmGQ |   |

To consume the changes feed of a large database from the beginning, you may want to increase the `batchSize` e.g. `{ batchSize: 10000, since:0}`. 

## Events

The objects returned by `changesReader.start()` and `changesReader.get()` emit the following events:

| Event  | Description                                                                                                                                                               | Data                       |   |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------|---|
| change | Each detected change is emitted individually.                                                                                                                             | A change object            |   |
| batch  | Each batch of changes is emitted in bulk in quantities up to `batchSize`.                                                                                                                              | An array of change objects |   |
| seq    | Each new sequence token (per HTTP request). This token can be passed into `changesReader` as the `since` parameter to resume changes feed consumption from a known point. | String                     |   |
| error  | On a fatal error, a descriptive object is returned and change consumption stops.                                                                                         | Error object               |   |
| end    | Emitted when the end of the changes feed is reached. `changesReader.get()` mode only,                                                                                     | Nothing                    |   |

The *changesReader* library will handle many temporal errors such as network connectivity, service capacity limits and malformed data but it will emit an `error` event and exit when fed incorrect authentication credentials or an invalid `since` token.

## What does a change object look like?

The `change` event delivers a change object that looks like this:

```js
{
	id: '1526458621285',
	changes: [{
		rev: '1-bdbb36882766a49dda4e967b68ec0e48'
	}]
}
```

The `id` is the unique identifier of the document that changed and the `changes` array contains the document revision tokens that were written to the database.

The `batch` event delivers an array of change objects.

If you need the *body* of the document(s) that have changed, then make an additional call to `db.list` passing in the array of document ids:

```js
db.list({ids: ['1526458621285', '1526458621286', '1526458621287']}).then(console.log);
```

## Building a resumable changes feed listener

The `changesReader` object gives you the building blocks to construct code that can listen to the changes feed, resuming from where it left off. To do this you will need to

- listen to the `seq` event and store the value it delivers to you. This is the sequence token of the latest change recieved.
- when starting up the *changesReader*, pass your last known `seq` value as the `since` parameter