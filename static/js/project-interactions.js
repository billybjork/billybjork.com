function closeProject(projectItem) {
    const projectDetail = projectItem.querySelector('.project-detail');
    const closeButton = projectItem.querySelector('.close-project');
    projectDetail.innerHTML = '';
    closeButton.style.display = 'none';
}

document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target.classList.contains('project-detail')) {
        const projectItem = event.detail.target.closest('.project-item');
        if (projectItem) {
            const projectHeader = projectItem.querySelector('.project-header');
            const closeButton = projectHeader.querySelector('.close-project');
            if (closeButton) {
                closeButton.style.display = 'inline-block';
            }
            projectHeader.scrollIntoView({behavior: 'smooth'});
        }
    }
});

document.body.addEventListener('htmx:beforeRequest', function(event) {
    if (event.detail.elt.classList.contains('project-header')) {
        const projectItem = event.detail.elt.closest('.project-item');
        const projectDetail = projectItem.querySelector('.project-detail');
        if (projectDetail.innerHTML.trim() !== '') {
            closeProject(projectItem);
            event.preventDefault();
        }
    }
});

document.addEventListener('click', function(event) {
    if (event.target.classList.contains('close-project')) {
        event.preventDefault();
        const projectItem = event.target.closest('.project-item');
        closeProject(projectItem);
    }
});