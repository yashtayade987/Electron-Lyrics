async function testAppleArtwork(artist, title, album) {
    console.log(`\nTesting: ${artist} - ${title} (album: ${album})`);
    
    // Try original params
    const params1 = new URLSearchParams({ artist, album: album || title, title });
    const url1 = `https://artwork.m8tec.top/api/v1/artwork/search?${params1.toString()}`;
    const res1 = await fetch(url1);
    console.log(`Query 1 [${url1}]: status ${res1.status}`);
    if (res1.ok) {
        const data1 = await res1.json();
        console.log('Result 1 url:', data1.url ? data1.url.substring(0, 60) + '...' : 'null');
    }

    // Try cleaned primary artist
    const cleanArtist = artist.split(/,|&|\bfeat\b|\bwith\b/i)[0].trim();
    const cleanAlbum = (album || title).replace(/\s*-\s*Single/i, '').trim();
    const params2 = new URLSearchParams({ artist: cleanArtist, album: cleanAlbum, title });
    const url2 = `https://artwork.m8tec.top/api/v1/artwork/search?${params2.toString()}`;
    const res2 = await fetch(url2);
    console.log(`Query 2 [${url2}]: status ${res2.status}`);
    if (res2.ok) {
        const data2 = await res2.json();
        console.log('Result 2 url:', data2.url ? data2.url.substring(0, 60) + '...' : 'null');
    }
}

async function run() {
    await testAppleArtwork('Lady Gaga, Bruno Mars', 'Die With A Smile', 'Die With A Smile - Single');
    await testAppleArtwork('The Weeknd', 'Blinding Lights', 'After Hours');
    await testAppleArtwork('Billie Eilish', 'BIRDS OF A FEATHER', 'HIT ME HARD AND SOFT');
    await testAppleArtwork('Taylor Swift', 'Fortnight (feat. Post Malone)', 'THE TORTURED POETS DEPARTMENT');
}
run();
