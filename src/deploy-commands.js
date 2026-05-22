/**
 * Command Deployment Script
 * Registers all slash commands with the Discord API.
 * Can deploy globally or to a specific guild based on environment variables.
 */
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        console.log(`📝 Loaded command: ${command.data.name}`);
    }
}

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in .env file!');
    process.exit(1);
}

if (!process.env.CLIENT_ID) {
    console.error('❌ CLIENT_ID is not set in .env file!');
    process.exit(1);
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

const GUILD_ID = process.env.GUILD_ID;

(async () => {
    try {
        console.log(`\n🔄 Started refreshing ${commands.length} application (/) commands...`);

        let data;
        if (GUILD_ID) {
            data = await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, GUILD_ID),
                { body: commands },
            );
            console.log(`✅ Successfully registered ${data.length} guild commands instantly!`);
        } else {
            data = await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands },
            );
            console.log(`✅ Successfully registered ${data.length} global commands!`);
            console.log('\n⚠️  Global commands may take up to 1 hour to propagate.');
        }

        console.log('\n📋 Registered commands:');
        data.forEach(cmd => console.log(`   - /${cmd.name}`));
        
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();
