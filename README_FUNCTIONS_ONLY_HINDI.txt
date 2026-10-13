केवल functions/ चाहिए तो functions-only ZIP Extract करें।
उसे अपने existing Admin project के root में रखें, ताकि firebase.json उसी root से चले।
R2 secrets .env में न डालें।
अगर अपने Admin source में दूसरे नए changes हो चुके हैं, बिना तुलना किए index.js overwrite न करें।
पहले Backup, फिर cd functions && npm ci, फिर केवल cleanupTemplateStorageOnWrite, publishTemplateCatalogOnWrite deploy करें।
