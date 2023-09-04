// Écouteur pour l'événement d'installation de l'extension.
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed!');
});

// Écouteur pour les messages envoyés à l'arrière-plan.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(message);

    // Ici, vous pouvez ajouter une logique supplémentaire pour gérer différents types de messages.
    // Par exemple :
    // if (message.type === 'someMessageType') {
    //     // Traitez le message de ce type ici.
    //     sendResponse({ response: 'Response for someMessageType' });
    // }

    // Notez que si vous utilisez sendResponse, vous devrez peut-être retourner true 
    // pour indiquer que la réponse sera envoyée de manière asynchrone.
    // return true;
});
