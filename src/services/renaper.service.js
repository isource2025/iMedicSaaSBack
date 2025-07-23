const renaperService = {
    getToken: async () => {
        const resp = await fetch("https://federador.msal.gob.ar/masterfile-federacion-service/api/usuarios/aplicacion/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(
                {
                    "nombre": "HQgdGgMcFxMaCl4SEh8FDFwCHBcCCBYdBA0B",
                    "clave": "IVQARl0wWyBBFQkLBEclO0M=",
                    "codDominio": "2.16.840.1.113883.2.10.43"
                }
            )
        });

        const data = await resp.json(); 
        return data.token;
    },

    search: async (NumeroDocumento, Sexo) => {
        const token = await renaperService.getToken();

        const resp = await fetch(`https://federador.msal.gob.ar/masterfile-federacion-service/api/personas/renaper?nroDocumento=${NumeroDocumento}&idSexo=${Sexo}`, {
            headers: {
                'token': token,
                'codDominio': '2.16.840.1.113883.2.10.43',
                'Cookie': '3bce928fd27e4c5312e5dc8399c6b646=ef88d1ab7d629f9684c914d5800da62d; 5fdd9d0dc549ca83cfa57b807604ff61=5008afb2e0a7c857e7fa7ee9b4947be3; 5fdd9d0dc549ca83cfa57b807604ff61=f33a9a15b80d24a32d42fd6d8682d52e; 6b0a2b1edfcd6fac4a6518a5ff413d8e=1eb2cf0308ed1876aea0a057202af66f'
            }
        })

        const data = await resp.json(); 
        return data;
    }
}

module.exports = renaperService;