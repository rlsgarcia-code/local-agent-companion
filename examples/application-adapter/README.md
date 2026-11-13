# Adaptador de aplicação — referência

Este exemplo é uma sonda de prontidão, não outro runtime. Ele carrega somente o SDK publicado, verifica o engine assinado, registra `companion-app` e negocia todas as capacidades obrigatórias.

```bash
COMPANION_ENGINE_BUNDLE=/caminho/companion-engine \
COMPANION_SDK_DIR=/caminho/sdk \
COMPANION_RELEASE_PUBLIC_KEY=/caminho/companion-release.pub \
COMPANION_APP_PROFILE=com.example.my-app \
node adapter.mjs
```

Depois da prontidão, acrescente o catálogo de ferramentas do domínio e o callback de `waitForRun`; não acrescente LangChain, um cliente de modelo ou armazenamento de conversa ao adaptador.
